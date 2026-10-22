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
  const chosen = await dialog.showOpenDialog({
    title: 'Markdown · HTML 게임 · 이미지 불러오기',
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Markdown · HTML · 이미지',
        extensions: ['md', 'html', 'htm', 'png', 'jpg', 'jpeg', 'webp', 'gif'],
      },
    ],
  });
  assertCurrent();
  if (chosen.canceled || !chosen.filePaths.length) return [];
  if (chosen.filePaths.length > 20)
    throw new CanvasError(
      'GC-IMPORT-001',
      '한 번에 최대 20개 파일을 선택해주세요.',
    );
  let total = 0;
  const files: { name: string; content: string }[] = [];
  for (const absolute of chosen.filePaths) {
    const name = path.basename(absolute),
      ext = path.extname(name).toLowerCase();
    const isHtml = ['.html', '.htm'].includes(ext);
    const stat = await fs.stat(absolute);
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
    const bytes = await fs.readFile(absolute);
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
  return applyFiles({ ...input, files });
}
