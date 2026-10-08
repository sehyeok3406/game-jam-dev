import type { Snapshot } from './project-store.ts';
import type { CanvasSheets } from './shared.ts';

export const CANVAS_SHEETS_PATH = '.canvas/canvases.json';
export const DEFAULT_CANVAS_ID = 'default';
export const canvasId = (value: unknown): string =>
  typeof value === 'string' && value ? value : DEFAULT_CANVAS_ID;

export function readCanvasSheets(raw?: string): CanvasSheets {
  if (raw === undefined)
    return {
      version: 1,
      canvases: [{ id: DEFAULT_CANVAS_ID, name: '기본 캔버스' }],
    };
  const value = JSON.parse(raw);
  if (
    value?.version !== 1 ||
    !Array.isArray(value.canvases) ||
    !value.canvases.length ||
    value.canvases.length > 100
  )
    throw new Error('캔버스 목록을 확인해주세요.');
  const ids = new Set<string>();
  for (const sheet of value.canvases) {
    if (
      !sheet ||
      typeof sheet.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(sheet.id) ||
      ids.has(sheet.id) ||
      typeof sheet.name !== 'string' ||
      !sheet.name.trim() ||
      sheet.name.length > 80
    )
      throw new Error('캔버스 이름 또는 ID를 확인해주세요.');
    ids.add(sheet.id);
  }
  return {
    version: 1,
    canvases: value.canvases.map((sheet: { id: string; name: string }) => ({
      id: sheet.id,
      name: sheet.name.trim(),
    })),
  };
}

export function assertCanvas(files: Snapshot, id: unknown) {
  const selected = canvasId(id);
  if (
    !readCanvasSheets(files[CANVAS_SHEETS_PATH]).canvases.some(
      (sheet) => sheet.id === selected,
    )
  )
    throw new Error('캔버스가 삭제되었거나 변경되었습니다. 다시 선택해주세요.');
  return selected;
}
