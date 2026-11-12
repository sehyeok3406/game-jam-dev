import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import {
  AUDIO_MIME,
  MAX_AUDIO_BYTES,
  audioDigest,
  audioExtension,
} from '../core/projects/audio-assets.ts';
import { inspectAudioFile } from '../adapters/filesystem/audio-assets.ts';
import { projectPath } from '../project-store.ts';

const scheme = 'gamejam-audio';
export function registerAudioScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme,
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

function audioRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return;
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end =
    match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start <= end &&
    start < size
  )
    return { start, end };
}

/** Playback URLs grant one file from the active local project and expire at session end. */
export class DesktopAudioProtocol {
  private signal?: AbortSignal;
  private files = new Map<
    string,
    { root: string; relative: string; mime: string }
  >();
  private tokens = new Map<string, string>();

  async url(root: string, relative: string, signal: AbortSignal) {
    const extension = typeof relative === 'string' && audioExtension(relative);
    if (!extension || !audioDigest(relative))
      throw Error('사운드 원본 경로를 확인해주세요.');
    const file = await projectPath(root, relative);
    const info = await inspectAudioFile(file).catch((error) => {
      if (error.code === 'ENOENT')
        throw Error('프로젝트에서 사운드 원본을 찾을 수 없습니다.');
      throw error;
    });
    if (info.pointer)
      throw Error(
        'Git LFS 원본이 필요합니다. 프로젝트 폴더에서 git lfs pull을 실행해주세요.',
      );
    if (info.bytes < 1 || info.bytes > MAX_AUDIO_BYTES)
      throw Error('사운드 파일 크기를 확인해주세요.');
    signal.throwIfAborted();
    if (this.signal !== signal) {
      this.signal = signal;
      this.files.clear();
      this.tokens.clear();
      signal.addEventListener(
        'abort',
        () => {
          if (this.signal !== signal) return;
          this.files.clear();
          this.tokens.clear();
        },
        { once: true },
      );
    }
    let token = this.tokens.get(relative);
    if (!token) {
      token = randomUUID();
      this.tokens.set(relative, token);
      this.files.set(token, { root, relative, mime: AUDIO_MIME[extension] });
    }
    return `${scheme}://local/${token}`;
  }

  start() {
    protocol.handle(scheme, async (request) => {
      const url = new URL(request.url);
      const asset =
        url.hostname === 'local' && this.files.get(url.pathname.slice(1));
      const signal = this.signal;
      if (!asset || !signal || signal.aborted)
        return new Response(null, { status: 404 });
      if (!['GET', 'HEAD'].includes(request.method))
        return new Response(null, { status: 405 });
      const file = await projectPath(asset.root, asset.relative).catch(
        () => null,
      );
      if (!file) return new Response(null, { status: 404 });
      const stat = await fs.stat(file).catch(() => null);
      if (
        signal.aborted ||
        !stat?.isFile() ||
        stat.size < 1 ||
        stat.size > MAX_AUDIO_BYTES
      )
        return new Response(null, { status: 404 });
      const headers = new Headers({
        'content-type': asset.mime,
        'accept-ranges': 'bytes',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      });
      const requested = request.headers.get('range');
      const range = requested ? audioRange(requested, stat.size) : undefined;
      if (requested && !range) {
        headers.set('content-range', `bytes */${stat.size}`);
        return new Response(null, { status: 416, headers });
      }
      if (range)
        headers.set(
          'content-range',
          `bytes ${range.start}-${range.end}/${stat.size}`,
        );
      headers.set(
        'content-length',
        String(range ? range.end - range.start + 1 : stat.size),
      );
      const stream =
        request.method === 'HEAD'
          ? null
          : (Readable.toWeb(
              createReadStream(file, { ...range, signal }),
            ) as ReadableStream<Uint8Array>);
      return new Response(stream, { status: range ? 206 : 200, headers });
    });
  }
}
