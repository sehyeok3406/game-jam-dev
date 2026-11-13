import { MAX_HTML_BYTES } from '../html-source';
import fs from 'node:fs/promises';
import path from 'node:path';
import { dialog, nativeImage } from 'electron';
import { CanvasError } from '../app-errors';
import {
  MAX_MARKDOWN_BYTES,
  MAX_IMAGE_BYTES,
  encodeAsset,
} from '../file-assets';
import type {
  ImportFilesInput,
  ImportBatchInput,
  CanvasDocument,
  AudioAsset,
  ModelAsset,
} from '../contracts/documents';
import { MAX_AUDIO_BYTES } from '../core/projects/audio-assets.ts';
import { localMediaExtension } from '../core/projects/local-media.ts';
import {
  modelExtension,
  modelSizeLimit,
  MAX_LOCAL_MEDIA_BATCH_BYTES,
} from '../core/projects/model-assets.ts';

type StageMedia = (
  source: string | Uint8Array,
  name: string,
  bytes: number,
) => Promise<AudioAsset | ModelAsset>;

/** OS selection and decoding are desktop-only; publication is an application service. */
export async function importSelectedFiles(
  input: ImportFilesInput,
  applyFiles: (input: ImportBatchInput) => Promise<CanvasDocument[]>,
  assertCurrent: () => void,
  authorize: () => void,
  options?: { paths?: string[]; stageMedia?: StageMedia; local?: boolean },
) {
  assertCurrent();
  if (
    !input ||
    !Number.isFinite(input.x) ||
    !Number.isFinite(input.y) ||
    !['asset', 'diagram'].includes(input.imagePurpose)
  )
    throw new CanvasError(
      'GC-IMPORT-001',
      '파일을 넣을 위치와 이미지 용도를 확인해주세요.',
    );
  authorize();
  const chosen =
    input.files === undefined && options?.paths === undefined
      ? await dialog.showOpenDialog({
          title: '프로젝트 파일 불러오기',
          properties: ['openFile', 'multiSelections'],
          filters: [
            {
              name: options?.stageMedia
                ? 'Markdown · HTML · 이미지 · 사운드 · 3D'
                : 'Markdown · HTML · 이미지',
              extensions: [
                'md',
                'html',
                'htm',
                'png',
                'jpg',
                'jpeg',
                'webp',
                'gif',
                ...(options?.stageMedia
                  ? ['mp3', 'wav', 'ogg', 'glb', 'fbx', 'obj', 'blend']
                  : []),
              ],
            },
          ],
        })
      : null;
  assertCurrent();
  if (chosen && (chosen.canceled || !chosen.filePaths.length)) return [];
  if (
    input.files !== undefined &&
    (!Array.isArray(input.files) ||
      input.files.some(
        (file) =>
          !file ||
          typeof file !== 'object' ||
          'path' in file ||
          typeof file.name !== 'string' ||
          !(file.bytes instanceof Uint8Array),
      ))
  )
    throw new CanvasError('GC-IMPORT-001', '불러올 파일 정보를 확인해주세요.');
  const paths = options?.paths ?? chosen?.filePaths;
  if (
    paths &&
    (!Array.isArray(paths) ||
      paths.some(
        (value) => typeof value !== 'string' || !path.isAbsolute(value),
      ))
  )
    throw Error('불러올 원본 파일을 확인해주세요.');
  const sources = paths ? paths.map((path) => ({ path })) : input.files!;
  const files = await readImportSources(
    sources,
    assertCurrent,
    options?.stageMedia,
    options?.local,
  );
  const {
    files: _bytes,
    scope: _scope,
    contextId: _context,
    ...position
  } = input;
  return applyFiles({ ...position, files });
}

/** Picker, clipboard file lists and browser drops share decoding and limits. */
export async function readImportSources(
  sources: ({ path: string } | { name: string; bytes: Uint8Array })[],
  assertCurrent: () => void,
  stageMedia?: StageMedia,
  local = false,
): Promise<ImportBatchInput['files']> {
  if (!sources.length || sources.length > 20)
    throw new CanvasError(
      'GC-IMPORT-001',
      '한 번에 최대 20개 파일을 선택해주세요.',
    );
  let total = 0;
  let mediaTotal = 0;
  const files: { name: string; content: string }[] = [];
  for (const source of sources) {
    assertCurrent();
    const absolute = 'path' in source ? source.path : undefined;
    const name = absolute
        ? path.basename(absolute)
        : 'name' in source
          ? source.name
          : '',
      ext = path.extname(name).toLowerCase();
    const media = localMediaExtension(name);
    if (
      !name ||
      name.length > 200 ||
      /[\\/]/.test(name) ||
      [...name].some((character) => character.charCodeAt(0) < 32) ||
      (!media &&
        ![
          '.md',
          '.html',
          '.htm',
          '.png',
          '.jpg',
          '.jpeg',
          '.webp',
          '.gif',
        ].includes(ext))
    )
      throw new CanvasError(
        'GC-IMPORT-001',
        `${name}: 지원하는 문서, 이미지, 사운드 또는 3D 파일인지 확인해주세요.`,
      );
    const isHtml = ['.html', '.htm'].includes(ext);
    const localHtml = local && isHtml;
    if ('bytes' in source && !(source.bytes instanceof Uint8Array))
      throw new CanvasError(
        'GC-IMPORT-001',
        '불러올 파일 데이터를 확인해주세요.',
      );
    const stat = absolute
      ? await fs.stat(absolute)
      : {
          size: 'bytes' in source ? source.bytes.byteLength : 0,
          isFile: () => true,
        };
    if (media) {
      if (!stageMedia)
        throw Error(
          '사운드와 3D 파일은 로컬 프로젝트의 불러오기 메뉴나 드롭으로 추가해주세요.',
        );
      const model = modelExtension(name);
      const limit = model ? modelSizeLimit(model) : MAX_AUDIO_BYTES;
      if (
        !stat.isFile() ||
        stat.size > limit ||
        (mediaTotal += stat.size) > MAX_LOCAL_MEDIA_BATCH_BYTES
      )
        throw Error(
          `${name}: 파일당 ${limit / (1024 * 1024)}MiB, 미디어는 한 번에 총 256MiB까지 불러올 수 있습니다.`,
        );
      const content = await stageMedia(
        absolute ?? (source as { bytes: Uint8Array }).bytes,
        name,
        stat.size,
      );
      files.push({ name, content: JSON.stringify(content) });
      continue;
    }
    if (
      !stat.isFile() ||
      (!localHtml &&
        stat.size >
          (isHtml
            ? MAX_HTML_BYTES
            : ext === '.md'
              ? MAX_MARKDOWN_BYTES
              : MAX_IMAGE_BYTES))
    )
      throw new CanvasError(
        isHtml ? 'GC-IMPORT-003' : 'GC-IMPORT-001',
        local
          ? `${name}: 파일을 확인해주세요. Markdown은 최대 2MB, 이미지는 최대 5MB까지 불러올 수 있습니다.`
          : `${name}: Markdown은 최대 2MB, HTML은 최대 8MB, 이미지는 최대 5MB까지 불러올 수 있습니다.`,
      );
    if (!localHtml) total += stat.size;
    if (total > 12_000_000)
      throw new CanvasError(
        'GC-IMPORT-001',
        '한 번에 최대 12MB까지 선택해주세요. 나눠서 불러올 수 있습니다.',
      );
    const bytes = absolute
      ? await fs.readFile(absolute)
      : Buffer.from((source as { bytes: Uint8Array }).bytes);
    // The selected disk file may have changed between stat and read.
    if (bytes.length !== stat.size)
      throw new CanvasError(
        'GC-IMPORT-001',
        `${name}: 파일이 변경되었습니다. 다시 불러와주세요.`,
      );
    assertCurrent();
    if (ext === '.md' || isHtml) {
      try {
        files.push({
          name,
          content: new TextDecoder('utf-8', {
            fatal: true,
            ignoreBOM: isHtml,
          }).decode(bytes),
        });
      } catch {
        throw new CanvasError(
          isHtml ? 'GC-IMPORT-003' : 'GC-IMPORT-001',
          `${name}: UTF-8 형식으로 저장한 ${isHtml ? 'HTML' : 'Markdown'} 파일을 사용해주세요.`,
        );
      }
    } else {
      const content = encodeAsset(`assets/images/import${ext}`, bytes);
      // nativeImage decodes PNG/JPEG, not every format Chromium can display.
      if (
        ['.png', '.jpg', '.jpeg'].includes(ext) &&
        nativeImage.createFromBuffer(bytes).isEmpty()
      )
        throw new CanvasError(
          'GC-IMPORT-002',
          `${name}: 이미지를 읽을 수 없습니다.`,
        );
      files.push({ name, content });
    }
  }
  assertCurrent();
  return files;
}
