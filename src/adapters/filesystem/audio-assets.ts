import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Snapshot } from '../../contracts/project.ts';
import {
  AUDIO_DIRECTORY,
  MAX_AUDIO_BYTES,
  audioAsset,
  audioDigest,
  audioExtension,
} from '../../core/projects/audio-assets.ts';
import matter from '../../markdown.ts';
import { projectPath } from '../../project-store.ts';

const objects = '.gamejam/local/audio-objects';
const pointerPrefix = 'version https://git-lfs.github.com/spec/v1';
const absent = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === 'ENOENT';

export function audioFromMarkdown(raw?: string) {
  return raw && raw.includes('audio_asset:')
    ? audioAsset(matter(raw).data.audio_asset)
    : undefined;
}

async function audioHeader(file: string) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw Error('사운드 원본 파일을 확인해주세요.');
    const buffer = Buffer.alloc(Math.min(stat.size, 65_536));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return { stat, header: buffer.subarray(0, bytesRead) };
  } finally {
    await handle.close();
  }
}

export async function inspectAudioFile(file: string) {
  const { stat, header } = await audioHeader(file);
  return {
    bytes: stat.size,
    pointer:
      stat.size < 1024 && header.toString('ascii').startsWith(pointerPrefix),
  };
}

function isAudioHeader(header: Buffer, extension: string) {
  const starts = (value: string, offset = 0) =>
    header.toString('latin1', offset, offset + value.length) === value;
  if (extension === 'mp3')
    return (
      header.length >= 10 &&
      (starts('ID3') || (header[0] === 255 && (header[1] & 0xe6) === 0xe2))
    );
  if (extension === 'ogg')
    return (
      header.length >= 32 &&
      starts('OggS') &&
      (header.includes('OpusHead') || header.includes('\x01vorbis'))
    );
  if (!starts('RIFF') || !starts('WAVE', 8)) return false;
  for (let offset = 12; offset + 10 <= header.length; ) {
    const size = header.readUInt32LE(offset + 4);
    if (starts('fmt ', offset)) {
      const format = header.readUInt16LE(offset + 8);
      return (
        size >= 16 &&
        (format === 1 ||
          (format === 0xfffe &&
            size >= 40 &&
            offset + 48 <= header.length &&
            header.readUInt16LE(offset + 32) === 1))
      );
    }
    offset += 8 + size + (size % 2);
  }
  return false;
}

async function objectPath(root: string, digest: string) {
  return projectPath(root, `${objects}/${digest}`, true);
}

export async function stageAudio(
  root: string,
  source: string | Uint8Array,
  name: string,
  expectedBytes: number,
  check: () => void,
  expectedDigest?: string,
) {
  const extension = audioExtension(name);
  if (!extension || expectedBytes <= 0 || expectedBytes > MAX_AUDIO_BYTES)
    throw Error(
      `${name}: MP3, PCM WAV, Ogg Vorbis·Opus를 파일당 50MiB까지 불러올 수 있습니다.`,
    );
  check();
  const temporary = await projectPath(
    root,
    `${objects}/${randomUUID()}.tmp`,
    true,
  );
  await fs.mkdir(path.dirname(temporary), { recursive: true });
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    await pipeline(
      typeof source === 'string'
        ? createReadStream(source)
        : Readable.from([source]),
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          try {
            check();
            bytes += chunk.length;
            if (bytes > expectedBytes)
              throw Error(`${name}: 원본 파일이 변경되었습니다.`);
            hash.update(chunk);
            done(null, chunk);
          } catch (error) {
            done(error as Error);
          }
        },
      }),
      createWriteStream(temporary, { flags: 'wx' }),
    );
    const digest = hash.digest('hex');
    if (
      bytes !== expectedBytes ||
      (expectedDigest && digest !== expectedDigest)
    )
      throw Error(`${name}: 원본 파일이 변경되었습니다.`);
    const { header } = await audioHeader(temporary);
    if (!isAudioHeader(header, extension))
      throw Error(`${name}: 지원하는 오디오 형식의 파일인지 확인해주세요.`);
    const destination = await objectPath(root, digest);
    check();
    // Exclusive publication keeps an older history object's bytes intact.
    await fs
      .copyFile(temporary, destination, constants.COPYFILE_EXCL)
      .catch((error) => {
        if (error.code !== 'EEXIST') throw error;
      });
    return {
      path: `${AUDIO_DIRECTORY}/${digest}.${extension}`,
      originalName: name,
      bytes,
    };
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function stageProjectAudio(
  root: string,
  sourceRoot: string,
  relative: string,
  check: () => void,
) {
  const digest = audioDigest(relative);
  if (!digest) throw Error('사운드 파일 경로를 확인해주세요.');
  const absolute = await projectPath(sourceRoot, relative);
  const info = await inspectAudioFile(absolute);
  if (info.pointer)
    throw Error('원본 사운드 파일을 받으려면 git lfs pull을 실행해주세요.');
  await stageAudio(
    root,
    absolute,
    path.basename(relative),
    info.bytes,
    check,
    digest,
  );
}

/** Document snapshots contain references only. Change the active binary once per digest. */
export async function planAudioChanges(
  root: string,
  baseline: Snapshot,
  changes: Record<string, string | null>,
  check: () => void,
) {
  const added = new Set<string>(),
    removed = new Set<string>();
  for (const [relative, raw] of Object.entries(changes)) {
    if (!relative.endsWith('.md')) continue;
    const before = audioFromMarkdown(baseline[relative])?.path;
    const after = audioFromMarkdown(raw ?? undefined)?.path;
    if (before === after) continue;
    if (before) removed.add(before);
    if (after) added.add(after);
  }
  for (const relative of added) removed.delete(relative);
  if (removed.size)
    for (const [relative, raw] of Object.entries(baseline)) {
      if (Object.hasOwn(changes, relative) || !relative.endsWith('.md'))
        continue;
      const asset = audioFromMarkdown(raw);
      if (asset) removed.delete(asset.path);
    }
  const create: { file: string; object: string }[] = [];
  const remove: typeof create = [];
  for (const relative of added) {
    const file = await projectPath(root, relative);
    if (
      await fs.stat(file).then(
        () => true,
        (error) => {
          if (!absent(error)) throw error;
          return false;
        },
      )
    )
      continue;
    const object = await objectPath(root, audioDigest(relative)!);
    await fs.access(object).catch(() => {
      throw Error(
        '사운드 원본을 찾을 수 없습니다. Git LFS 또는 로컬 프로젝트 기록을 확인해주세요.',
      );
    });
    create.push({ file, object });
  }
  for (const relative of removed) {
    const file = await projectPath(root, relative);
    const info = await inspectAudioFile(file).catch((error) => {
      if (!absent(error)) throw error;
      return undefined;
    });
    if (!info || info.pointer) continue;
    await stageProjectAudio(root, root, relative, check);
    remove.push({
      file,
      object: await objectPath(root, audioDigest(relative)!),
    });
  }
  return { create, remove };
}
