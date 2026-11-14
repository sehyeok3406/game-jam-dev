import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import { protocol, type Session } from 'electron';
import type { GameBuildAssetReference } from '../contracts/game-build.ts';
import { GAME_ASSET_ORIGIN } from '../contracts/game-build-execution.ts';
import { mediaLocation } from '../core/projects/local-media.ts';
import { gameBuildAssetMime } from '../core/projects/game-build-assets.ts';
import {
  inspectMediaFile,
  openGameBuildAsset,
} from '../adapters/filesystem/local-media.ts';
import { projectPath } from '../project-store.ts';

const scheme = 'gamejam-media';
type GameGrant = {
  root: string;
  asset: GameBuildAssetReference;
  signal: AbortSignal;
};

export function registerMediaScheme() {
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

function mediaRange(header: string, size: number) {
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

export async function resolveMediaFile(root: string, relative: string) {
  const media = mediaLocation(relative);
  if (!media) throw Error('미디어 원본 경로를 확인해주세요.');
  const file = await projectPath(root, relative);
  const info = await inspectMediaFile(file).catch((error) => {
    if (error.code === 'ENOENT')
      throw Error('프로젝트에서 미디어 원본을 찾을 수 없습니다.');
    throw error;
  });
  if (info.pointer)
    throw Error(
      'Git LFS 원본이 필요합니다. 프로젝트 폴더에서 git lfs pull을 실행해주세요.',
    );
  if (info.bytes < 1 || info.bytes > media.maxBytes)
    throw Error('미디어 파일 크기를 확인해주세요.');
  return { file, ...media };
}

/** Preview URLs grant one file from the active local project and expire at session end. */
export class DesktopMediaProtocol {
  private signal?: AbortSignal;
  private files = new Map<
    string,
    { root: string; relative: string; mime: string; maxBytes: number }
  >();
  private tokens = new Map<string, string>();
  private gameFiles = new Map<string, GameGrant>();
  private gameUrls = new Map<string, string>();

  gameAssets(
    root: string,
    assets: readonly GameBuildAssetReference[],
    signal: AbortSignal,
    session?: Session,
  ) {
    signal.throwIfAborted();
    const privateFiles = session
      ? new Map<string, GameGrant>()
      : this.gameFiles;
    const lifetime = session ? new AbortController() : undefined;
    const grantSignal = lifetime
      ? AbortSignal.any([signal, lifetime.signal])
      : signal;
    if (session)
      session.protocol.handle(scheme, (request) =>
        this.gameResponse(request, privateFiles),
      );
    const urls = Object.fromEntries(
      assets.map((asset) => {
        const key = JSON.stringify([
          root,
          asset.path,
          asset.sha256,
          asset.runtime?.sha256,
        ]);
        let token = session ? undefined : this.gameUrls.get(key);
        if (!token || privateFiles.get(token)?.signal !== grantSignal) {
          token = randomUUID();
          const id = token;
          privateFiles.set(id, { root, asset, signal: grantSignal });
          if (!session) this.gameUrls.set(key, id);
          grantSignal.addEventListener(
            'abort',
            () => {
              privateFiles.delete(id);
              if (this.gameUrls.get(key) === id) this.gameUrls.delete(key);
            },
            { once: true },
          );
        }
        return [asset.key, `${GAME_ASSET_ORIGIN}/${token}`];
      }),
    );
    return {
      urls,
      close: () => {
        if (session) {
          lifetime!.abort();
          session.protocol.unhandle(scheme);
        }
      },
    };
  }

  private async gameResponse(request: Request, files: Map<string, GameGrant>) {
    const url = new URL(request.url);
    const grant =
      url.host === 'game-assets' &&
      !url.search &&
      files.get(url.pathname.slice(1));
    if (!grant || grant.signal.aborted)
      return new Response(null, { status: 404 });
    if (!['GET', 'HEAD'].includes(request.method))
      return new Response(null, { status: 405 });
    try {
      const handle = await openGameBuildAsset(
        grant.root,
        grant.asset,
        grant.signal,
      );
      const size = grant.asset.runtime?.bytes ?? grant.asset.bytes;
      const headers = new Headers({
        'content-type': gameBuildAssetMime(grant.asset),
        'accept-ranges': 'bytes',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      });
      const requested = request.headers.get('range');
      const range = requested ? mediaRange(requested, size) : undefined;
      if (requested && !range) {
        await handle.close();
        headers.set('content-range', `bytes */${size}`);
        return new Response(null, { status: 416, headers });
      }
      if (range)
        headers.set(
          'content-range',
          `bytes ${range.start}-${range.end}/${size}`,
        );
      headers.set(
        'content-length',
        String(range ? range.end - range.start + 1 : size),
      );
      if (request.method === 'HEAD') await handle.close();
      return new Response(
        request.method === 'HEAD'
          ? null
          : (Readable.toWeb(
              handle.createReadStream({
                start: range?.start ?? 0,
                end: range?.end,
                signal: grant.signal,
              }),
            ) as ReadableStream<Uint8Array>),
        { status: range ? 206 : 200, headers },
      );
    } catch {
      return new Response(null, {
        status: 404,
        headers: { 'access-control-allow-origin': '*' },
      });
    }
  }

  async url(root: string, relative: string, signal: AbortSignal) {
    const { mime, maxBytes } = await resolveMediaFile(root, relative);
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
      this.files.set(token, { root, relative, mime, maxBytes });
    }
    return `${scheme}://local/${token}`;
  }

  start() {
    protocol.handle(scheme, async (request) => {
      const url = new URL(request.url);
      if (url.hostname === 'game-assets')
        return this.gameResponse(request, this.gameFiles);
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
        stat.size > asset.maxBytes
      )
        return new Response(null, { status: 404 });
      const headers = new Headers({
        'content-type': asset.mime,
        'accept-ranges': 'bytes',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      });
      const requested = request.headers.get('range');
      const range = requested ? mediaRange(requested, stat.size) : undefined;
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
