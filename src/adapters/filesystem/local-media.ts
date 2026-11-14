import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Snapshot } from '../../contracts/project.ts';
import type {
  GameBuildAssetFile,
  GameBuildAssetReference,
  GameBuildProjectAsset,
} from '../../contracts/game-build.ts';
import { glbJsonBytes, validateGlbJson } from '../../core/projects/glb.ts';
import {
  gameBuildAssetReferences,
  isGameBuildProjectAsset,
  isGameBuildManifestPath,
} from '../../core/projects/game-build-assets.ts';
import { validateImage } from '../../file-assets.ts';
import {
  AUDIO_DIRECTORY,
  MAX_AUDIO_BYTES,
  audioAsset,
  audioExtension,
} from '../../core/projects/audio-assets.ts';
import {
  localMediaPaths,
  mediaLocation,
} from '../../core/projects/local-media.ts';
import {
  objResourceFormat,
  objResourceLocation,
} from '../../core/projects/obj-resources.ts';
import {
  MODEL_DIRECTORY,
  modelAsset,
  modelExtension,
  modelSizeLimit,
} from '../../core/projects/model-assets.ts';
import matter from '../../markdown.ts';
import { projectPath } from '../../project-store.ts';

const objects = (kind: 'audio' | 'model') => `.gamejam/local/${kind}-objects`;
const pointerPrefix = 'version https://git-lfs.github.com/spec/v1';
const absent = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === 'ENOENT';

export function localMediaFromMarkdown(raw?: string) {
  if (!raw || (!raw.includes('audio_asset:') && !raw.includes('model_asset:')))
    return;
  const { data } = matter(raw);
  return audioAsset(data.audio_asset) ?? modelAsset(data.model_asset);
}

async function mediaHeader(file: string) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw Error('미디어 원본 파일을 확인해주세요.');
    const buffer = Buffer.alloc(Math.min(stat.size, 65_536));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return { stat, header: buffer.subarray(0, bytesRead) };
  } finally {
    await handle.close();
  }
}

export async function inspectMediaFile(file: string) {
  const { stat, header } = await mediaHeader(file);
  return {
    bytes: stat.size,
    pointer:
      stat.size < 1024 && header.toString('ascii').startsWith(pointerPrefix),
  };
}

/** Check and stream the same open file, including for native media range reads. */
export async function openGameBuildAsset(
  root: string,
  asset: GameBuildProjectAsset,
  signal?: AbortSignal,
  source = false,
) {
  if (!isGameBuildProjectAsset(asset))
    throw Error('게임 에셋 정보를 확인해주세요.');
  const descriptor = !source && asset.kind === 'blend' ? asset.runtime : asset;
  const format = !source && asset.kind === 'blend' ? 'glb' : asset.kind;
  return openVerifiedAssetFile(root, descriptor, format, signal);
}

export async function openVerifiedAssetFile(
  root: string,
  asset: GameBuildAssetFile,
  format: GameBuildProjectAsset['kind'] | 'mtl',
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const file = await projectPath(root, asset.path);
  const handle = await fs.open(file, 'r').catch((error) => {
    if (absent(error))
      throw Error('프로젝트에서 게임 에셋 원본을 찾을 수 없습니다.');
    throw error;
  });
  try {
    const before = await handle.stat();
    const header = Buffer.alloc(Math.min(before.size, 65_536));
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const prefix = header.subarray(0, bytesRead);
    if (
      before.size < 1024 &&
      prefix.toString('ascii').startsWith(pointerPrefix)
    )
      throw Error(
        'Git LFS 원본이 필요합니다. 프로젝트 폴더에서 git lfs pull을 실행해주세요.',
      );
    if (!before.isFile() || before.size !== asset.bytes)
      throw Error('게임 에셋 원본 크기가 변경되었습니다.');
    const extension = asset.path.split('.').at(-1)!;
    if (format === 'glb') {
      const json = Buffer.alloc(glbJsonBytes(prefix, before.size));
      if (
        (await handle.read(json, 0, json.length, 20)).bytesRead !== json.length
      )
        throw Error('GLB JSON 청크를 읽을 수 없습니다.');
      validateGlbJson(new TextDecoder('utf-8', { fatal: true }).decode(json));
    } else if (format === 'image') {
      const image = Buffer.alloc(before.size);
      if (
        (await handle.read(image, 0, image.length, 0)).bytesRead !==
        image.length
      )
        throw Error('이미지 원본을 읽을 수 없습니다.');
      validateImage(image, extension);
    } else if (
      !(format === 'audio'
        ? isAudioHeader(prefix, extension)
        : isModelHeader(prefix, extension, before.size))
    ) {
      throw Error('게임 에셋 원본 형식을 확인해주세요.');
    }
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({
      start: 0,
      autoClose: false,
      signal,
    }))
      hash.update(chunk);
    const after = await handle.stat();
    signal?.throwIfAborted();
    if (
      hash.digest('hex') !== asset.sha256 ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw Error(
        '게임 에셋 원본이 변경되었습니다. 캔버스에 다시 불러와주세요.',
      );
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function verifyGameBuildAsset(
  root: string,
  asset: GameBuildProjectAsset,
  signal?: AbortSignal,
) {
  if (asset.kind === 'blend')
    await (await openGameBuildAsset(root, asset, signal, true)).close();
  await (await openGameBuildAsset(root, asset, signal)).close();
  for (const resource of asset.resources ?? [])
    await (await openObjResource(root, resource, signal)).close();
}

export async function openObjResource(
  root: string,
  resource: import('../../contracts/documents.ts').ObjResource,
  signal?: AbortSignal,
) {
  const format = objResourceLocation(resource.path);
  if (!format) throw Error('OBJ 재질 파일 경로를 확인해주세요.');
  return openVerifiedAssetFile(
    root,
    { ...resource, sha256: format.digest },
    format.extension === 'mtl' ? 'mtl' : 'image',
    signal,
  );
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

function isModelHeader(header: Buffer, extension: string, bytes: number) {
  if (extension === 'glb')
    return (
      header.length >= 20 &&
      header.toString('ascii', 0, 4) === 'glTF' &&
      header.readUInt32LE(4) === 2 &&
      header.readUInt32LE(8) === bytes &&
      header.readUInt32LE(12) <= bytes - 20 &&
      header.toString('ascii', 16, 20) === 'JSON'
    );
  if (extension === 'fbx')
    return (
      header.toString('latin1', 0, 23) === 'Kaydara FBX Binary  \0\x1a\0' ||
      /^(?:\s*;[^\r\n]*(?:\r?\n|$))*\s*FBXHeaderExtension\s*:/i.test(
        header.toString('utf8'),
      )
    );
  if (extension === 'blend')
    return (
      header.toString('ascii', 0, 7) === 'BLENDER' ||
      (header.length > 4 &&
        (header.readUInt32BE(0) === 0x28b52ffd ||
          header.readUInt16BE(0) === 0x1f8b))
    );
  return !header.includes(0) && header.toString('utf8').trim().length > 0;
}

async function objectPath(
  root: string,
  media: NonNullable<ReturnType<typeof mediaLocation>>,
) {
  return projectPath(root, `${objects(media.kind)}/${media.digest}`, true);
}

function imageRecoveryPath(asset: GameBuildAssetFile) {
  return `.gamejam/local/game-image-objects/${asset.sha256}.${asset.path.split('.').at(-1)}`;
}

export async function stageLocalMedia(
  root: string,
  source: string | Uint8Array,
  name: string,
  expectedBytes: number,
  check: () => void,
  expectedDigest?: string,
  companion = false,
) {
  const audio = audioExtension(name);
  const model = modelExtension(name);
  const resource = companion ? objResourceFormat(name) : undefined;
  if (!audio && !model && !resource)
    throw Error('지원하는 미디어 파일인지 확인해주세요.');
  const maxBytes =
    resource?.maxBytes ?? (model ? modelSizeLimit(model) : MAX_AUDIO_BYTES);
  if (
    !Number.isSafeInteger(expectedBytes) ||
    expectedBytes <= 0 ||
    expectedBytes > maxBytes
  )
    throw Error(
      `${name}: 파일당 ${maxBytes / (1024 * 1024)}MiB까지 불러올 수 있습니다.`,
    );
  check();
  const temporary = await projectPath(
    root,
    `${objects(audio ? 'audio' : 'model')}/${randomUUID()}.tmp`,
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
    const { header } = await mediaHeader(temporary);
    if (resource && resource.extension !== 'mtl')
      validateImage(await fs.readFile(temporary), resource.extension);
    const supported = audio
      ? isAudioHeader(header, audio)
      : (resource && resource.extension !== 'mtl') ||
        isModelHeader(header, resource?.extension ?? model!, bytes);
    if (!supported)
      throw Error(
        `${name}: 지원하는 ${audio ? '오디오' : '3D 모델'} 형식의 파일인지 확인해주세요.`,
      );
    const relative = `${audio ? AUDIO_DIRECTORY : MODEL_DIRECTORY}/${digest}.${audio ?? model ?? resource!.extension}`;
    const destination = await objectPath(root, mediaLocation(relative)!);
    check();
    // Exclusive publication keeps an older history object's bytes intact.
    await fs
      .copyFile(temporary, destination, constants.COPYFILE_EXCL)
      .catch((error) => {
        if (error.code !== 'EEXIST') throw error;
      });
    return {
      path: relative,
      originalName: name,
      bytes,
    };
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function stageProjectMedia(
  root: string,
  sourceRoot: string,
  relative: string,
  check: () => void,
) {
  const media = mediaLocation(relative);
  if (!media) throw Error('미디어 파일 경로를 확인해주세요.');
  const absolute = await projectPath(sourceRoot, relative);
  const info = await inspectMediaFile(absolute);
  if (info.pointer)
    throw Error('미디어 원본을 받으려면 git lfs pull을 실행해주세요.');
  await stageLocalMedia(
    root,
    absolute,
    path.basename(relative),
    info.bytes,
    check,
    media.digest,
    !!objResourceLocation(relative),
  );
}

/** Document snapshots contain references only. Change the active binary once per digest. */
export async function planLocalMediaChanges(
  root: string,
  baseline: Snapshot,
  changes: Record<string, string | null>,
  check: () => void,
) {
  const added = new Set<string>(),
    removed = new Set<string>();
  const imageReferences = new Map<string, GameBuildAssetReference>();
  for (const [relative, raw] of Object.entries(changes)) {
    if (isGameBuildManifestPath(relative)) {
      if (raw !== null) {
        for (const asset of gameBuildAssetReferences(raw))
          if (asset.kind === 'image') imageReferences.set(asset.path, asset);
          else {
            added.add(asset.path);
            for (const resource of asset.resources ?? [])
              added.add(resource.path);
          }
      } else if (baseline[relative] !== undefined) {
        for (const asset of gameBuildAssetReferences(baseline[relative])) {
          if (asset.kind !== 'image' || baseline[asset.path] === undefined)
            continue;
          const object = await projectPath(
            root,
            imageRecoveryPath(asset),
            true,
          );
          if (
            await fs.stat(object).then(
              (stat) => stat.isFile(),
              () => false,
            )
          )
            continue;
          const file = await projectPath(root, asset.path);
          await fs.mkdir(path.dirname(object), { recursive: true });
          check();
          await (await openGameBuildAsset(root, asset)).close();
          await fs
            .copyFile(file, object, constants.COPYFILE_EXCL)
            .catch((error) => {
              if (error.code !== 'EEXIST') throw error;
            });
        }
      }
      continue;
    }
    if (!relative.endsWith('.md')) continue;
    const before = localMediaPaths(localMediaFromMarkdown(baseline[relative]));
    const after = localMediaPaths(localMediaFromMarkdown(raw ?? undefined));
    for (const path of before) if (!after.includes(path)) removed.add(path);
    for (const path of after) if (!before.includes(path)) added.add(path);
  }
  for (const relative of added) removed.delete(relative);
  if (removed.size)
    for (const [relative, raw] of Object.entries(baseline)) {
      if (Object.hasOwn(changes, relative)) continue;
      if (isGameBuildManifestPath(relative)) {
        for (const asset of gameBuildAssetReferences(raw)) {
          removed.delete(asset.path);
          for (const resource of asset.resources ?? [])
            removed.delete(resource.path);
        }
      }
      if (!relative.endsWith('.md')) continue;
      for (const path of localMediaPaths(localMediaFromMarkdown(raw)))
        removed.delete(path);
    }
  const create: { file: string; object: string }[] = [];
  const remove: typeof create = [];
  for (const asset of imageReferences.values()) {
    if (
      baseline[asset.path] !== undefined ||
      typeof changes[asset.path] === 'string'
    )
      continue;
    if (changes[asset.path] === null)
      throw Error(`게임에서 사용하는 이미지입니다: ${asset.path}`);
    const file = await projectPath(root, asset.path);
    const objectPath = imageRecoveryPath(asset);
    const object = await projectPath(root, objectPath, true);
    await (
      await openVerifiedAssetFile(
        root,
        { ...asset, path: objectPath },
        'image',
      ).catch(() => {
        throw Error(
          `복원할 게임 이미지 원본을 찾을 수 없습니다: ${asset.path}`,
        );
      })
    ).close();
    create.push({ file, object });
  }
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
    const object = await objectPath(root, mediaLocation(relative)!);
    await fs.access(object).catch(() => {
      throw Error(
        '미디어 원본을 찾을 수 없습니다. Git LFS 또는 로컬 프로젝트 기록을 확인해주세요.',
      );
    });
    create.push({ file, object });
  }
  for (const relative of removed) {
    const file = await projectPath(root, relative);
    const info = await inspectMediaFile(file).catch((error) => {
      if (!absent(error)) throw error;
      return undefined;
    });
    if (!info || info.pointer) continue;
    await stageProjectMedia(root, root, relative, check);
    remove.push({
      file,
      object: await objectPath(root, mediaLocation(relative)!),
    });
  }
  return { create, remove };
}
