import { randomUUID } from 'node:crypto';
import { CanvasError } from './app-errors.ts';
import { encodeAsset, MAX_IMAGE_BYTES, validateImage } from './file-assets.ts';

export const CANVAS_CLIPBOARD_MIME =
  'web application/x.gamejam.canvas-selection';
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const imageTypes = [
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
] as const;
export type ClipboardSource = {
  types: readonly string[];
  getType: (mime: string) => Promise<unknown>;
};
export type ClipboardContents =
  | { kind: 'internal'; copyId: string }
  | { kind: 'stale-internal' | 'empty' | 'unsupported' }
  | { kind: 'images'; files: { name: string; content: string }[] };

export function assertClipboardDimensions(bytes: Buffer, ext: string) {
  let width = 0,
    height = 0;
  if (ext === 'png' && bytes.length >= 24) {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (ext === 'jpg' || ext === 'jpeg') {
    let offset = 2;
    while (offset + 1 < bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const size = bytes.readUInt16BE(offset);
      if (size < 2 || offset + size > bytes.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        if (size < 8) break;
        height = bytes.readUInt16BE(offset + 3);
        width = bytes.readUInt16BE(offset + 5);
        break;
      }
      offset += size;
    }
  } else return;
  if (!width || !height || width * height > 32_000_000)
    throw new CanvasError(
      'GC-IMPORT-002',
      '클립보드 이미지 크기가 올바르지 않거나 3,200만 픽셀을 초과합니다.',
    );
}

/** One MIME per item; token precedence never falls back to stale local refs. */
export async function readCanvasClipboard(
  items: ClipboardSource[],
  expectedCopyId?: string,
  decode?: (bytes: Buffer, ext: string) => void,
): Promise<ClipboardContents> {
  const tokenItem = items.find((item) =>
    item.types.includes(CANVAS_CLIPBOARD_MIME),
  );
  if (tokenItem) {
    const blob = await tokenItem.getType(CANVAS_CLIPBOARD_MIME);
    if (!(blob instanceof Blob) || blob.size > 200)
      return { kind: 'stale-internal' };
    try {
      const token = JSON.parse(await blob.text());
      return token.version === 1 &&
        typeof token.copyId === 'string' &&
        UUID_PATTERN.test(token.copyId) &&
        token.copyId === expectedCopyId
        ? { kind: 'internal', copyId: token.copyId }
        : { kind: 'stale-internal' };
    } catch {
      return { kind: 'stale-internal' };
    }
  }
  const selected = items.flatMap((item) => {
    const format = imageTypes.find(([mime]) => item.types.includes(mime));
    return format ? [{ item, mime: format[0], ext: format[1] }] : [];
  });
  if (!selected.length)
    return {
      kind: items.some((i) => i.types.some((t) => t.startsWith('image/')))
        ? 'unsupported'
        : 'empty',
    };
  if (selected.length > 20)
    throw new CanvasError(
      'GC-IMPORT-001',
      '한 번에 최대 20개 이미지를 붙여넣을 수 있습니다.',
    );
  let total = 0;
  const blobs: { blob: Blob; ext: string }[] = [];
  for (const { item, mime, ext } of selected) {
    const blob = await item.getType(mime);
    if (!(blob instanceof Blob))
      throw new CanvasError(
        'GC-IMPORT-002',
        '클립보드 이미지를 읽을 수 없습니다. 다시 복사해주세요.',
      );
    if (blob.size > MAX_IMAGE_BYTES)
      throw new CanvasError(
        'GC-IMPORT-002',
        '이미지는 한 장당 5MB까지 붙여넣을 수 있습니다.',
      );
    total += blob.size;
    if (total > 12_000_000)
      throw new CanvasError(
        'GC-IMPORT-001',
        '한 번에 최대 12MB까지 붙여넣을 수 있습니다.',
      );
    blobs.push({ blob, ext });
  }
  const files = [];
  for (const { blob, ext } of blobs) {
    const bytes = Buffer.from(await blob.arrayBuffer());
    validateImage(bytes, ext);
    assertClipboardDimensions(bytes, ext);
    decode?.(bytes, ext);
    files.push({
      name: `clipboard-${randomUUID()}.${ext}`,
      content: encodeAsset(`assets/images/clipboard.${ext}`, bytes),
    });
  }
  return { kind: 'images', files };
}

/** Cache pending work as well as settled results; errors must not trigger a resend. */
export class ClipboardRequestCache {
  private entries = new Map<
    string,
    { time: number; pending: boolean; result: Promise<unknown> }
  >();
  clear() {
    this.entries.clear();
  }
  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const now = Date.now();
    for (const [id, entry] of this.entries)
      if (!entry.pending && now - entry.time > 300_000) this.entries.delete(id);
    const existing = this.entries.get(key);
    if (existing) return existing.result as Promise<T>;
    const entry = {
      time: now,
      pending: true,
      result: Promise.resolve().then(operation),
    };
    this.entries.set(key, entry);
    const settled = () => {
      entry.pending = false;
      entry.time = Date.now();
      for (const [id, cached] of this.entries) {
        if (this.entries.size <= 128) break;
        if (!cached.pending) this.entries.delete(id);
      }
    };
    void entry.result.then(settled, settled);
    return entry.result;
  }
}
