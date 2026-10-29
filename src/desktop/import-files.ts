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
} from '../contracts/documents';

/** OS selection and decoding are desktop-only; publication is an application service. */
export async function importSelectedFiles(
  input: ImportFilesInput,
  applyFiles: (input: ImportBatchInput) => Promise<CanvasDocument[]>,
  assertCurrent: () => void,
  authorize: () => void,
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
    input.files === undefined
      ? await dialog.showOpenDialog({
          title: 'Markdown · HTML 게임 · 이미지 불러오기',
          properties: ['openFile', 'multiSelections'],
          filters: [
            {
              name: 'Markdown · HTML · 이미지',
              extensions: [
                'md',
                'html',
                'htm',
                'png',
                'jpg',
                'jpeg',
                'webp',
                'gif',
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
  const sources = chosen
    ? chosen.filePaths.map((path) => ({ path }))
    : input.files!;
  const files = await readImportSources(sources, assertCurrent);
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
): Promise<ImportBatchInput['files']> {
  if (!sources.length || sources.length > 20)
    throw new CanvasError(
      'GC-IMPORT-001',
      '한 번에 최대 20개 파일을 선택해주세요.',
    );
  let total = 0;
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
    if (
      !name ||
      name.length > 200 ||
      /[\\/\x00-\x1f]/.test(name) ||
      ![
        '.md',
        '.html',
        '.htm',
        '.png',
        '.jpg',
        '.jpeg',
        '.webp',
        '.gif',
      ].includes(ext)
    )
      throw new CanvasError(
        'GC-IMPORT-001',
        `${name}: MD, HTML, HTM, PNG, JPG, WebP, GIF 파일만 지원합니다.`,
      );
    const isHtml = ['.html', '.htm'].includes(ext);
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
    if (
      !stat.isFile() ||
      stat.size >
        (isHtml
          ? MAX_HTML_BYTES
          : ext === '.md'
            ? MAX_MARKDOWN_BYTES
            : MAX_IMAGE_BYTES)
    )
      throw new CanvasError(
        isHtml ? 'GC-IMPORT-003' : 'GC-IMPORT-001',
        `${name}: Markdown은 최대 2MB, HTML은 최대 8MB, 이미지는 최대 5MB까지 불러올 수 있습니다.`,
      );
    total += stat.size;
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
