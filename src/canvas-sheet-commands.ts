import matter from './markdown.ts';
import type { Snapshot } from './project-store.ts';
import type { CanvasSheetCommand } from './shared.ts';
import { isPreviewPath } from './preview-output.ts';
import { htmlSourcePath, sourceMetadata } from './html-source.ts';
import {
  CANVAS_SHEETS_PATH,
  DEFAULT_CANVAS_ID,
  canvasId,
  readCanvasSheets,
  assertCanvas,
} from './canvas-sheets.ts';

export function validateCanvasMembership(files: Snapshot) {
  const sheets = readCanvasSheets(files[CANVAS_SHEETS_PATH]);
  const ids = new Set(sheets.canvases.map((sheet) => sheet.id));
  for (const [path, raw] of Object.entries(files)) {
    if (!path.endsWith('.md') || path.startsWith('output/')) continue;
    const data = matter(raw).data;
    if (
      data.canvas_id !== undefined &&
      (typeof data.canvas_id !== 'string' || !ids.has(data.canvas_id))
    )
      throw new Error(`문서의 캔버스를 찾을 수 없습니다: ${path}`);
    if (!ids.has(canvasId(data.canvas_id)))
      throw new Error(`기본 캔버스 소속을 확인해주세요: ${path}`);
    if (path.startsWith('sections/'))
      for (const member of data.members ?? []) {
        if (
          files[member.path] &&
          canvasId(matter(files[member.path]).data.canvas_id) !==
            canvasId(data.canvas_id)
        )
          throw new Error('섹션과 내부 자료는 같은 캔버스에 있어야 합니다.');
      }
  }
  // HTML without a management record still belongs to the legacy default canvas.
  for (const path of Object.keys(files).filter(isPreviewPath))
    if (!files[htmlSourcePath(path)] && !ids.has(DEFAULT_CANVAS_ID))
      throw new Error('HTML의 기본 캔버스 소속을 확인해주세요.');
}

/** Atomic sheet operations preserve physical paths and content. */
export function changeCanvasSheets(
  files: Snapshot,
  input: CanvasSheetCommand,
): Snapshot {
  const sheets = readCanvasSheets(files[CANVAS_SHEETS_PATH]);
  const actual = files[CANVAS_SHEETS_PATH] ?? null;
  if (input.expected !== actual)
    throw new Error(
      '다른 팀원이 캔버스 목록을 변경했습니다. 새 목록에서 다시 시도해주세요.',
    );
  const next = { ...files };
  const id = input.id;
  const sheet = sheets.canvases.find((item) => item.id === id);
  const name = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 80)
      throw new Error('캔버스 이름을 1~80자로 입력해주세요.');
    return value.trim();
  };
  const assign = (path: string, target: string) => {
    if (isPreviewPath(path)) {
      if (!next[path]) throw new Error('HTML을 찾을 수 없습니다.');
      const source = htmlSourcePath(path);
      next[source] ??= sourceMetadata(path, next[path]);
      path = source;
    }
    if (!path.endsWith('.md') || path.startsWith('output/') || !next[path])
      throw new Error('이동할 자료를 찾을 수 없습니다.');
    const parsed = matter(next[path]);
    next[path] = matter.stringify(parsed.content, {
      ...parsed.data,
      canvas_id: target,
    });
  };
  if (input.action === 'add') {
    if (
      !/^[a-zA-Z0-9_-]{1,100}$/.test(id) ||
      sheet ||
      sheets.canvases.length >= 100
    )
      throw new Error('캔버스를 추가할 수 없습니다.');
    sheets.canvases.push({ id, name: name(input.name) });
  } else if (input.action === 'rename') {
    if (!sheet) throw new Error('캔버스를 찾을 수 없습니다.');
    sheet.name = name(input.name);
  } else if (input.action === 'reorder') {
    if (
      !Array.isArray(input.order) ||
      input.order.length !== sheets.canvases.length ||
      new Set(input.order).size !== sheets.canvases.length ||
      input.order.some(
        (key) => !sheets.canvases.some((item) => item.id === key),
      )
    )
      throw new Error('캔버스 순서를 확인해주세요.');
    sheets.canvases = input.order.map(
      (key) => sheets.canvases.find((item) => item.id === key)!,
    );
  } else if (input.action === 'move' || input.action === 'delete') {
    if (!sheet) throw new Error('캔버스를 찾을 수 없습니다.');
    const target = assertCanvas(files, input.targetId);
    if (target === id) throw new Error('다른 캔버스를 선택해주세요.');
    if (input.action === 'delete' && sheets.canvases.length === 1)
      throw new Error('마지막 캔버스는 삭제할 수 없습니다.');
    const paths = new Set<string>();
    if (input.action === 'delete') {
      for (const [path, raw] of Object.entries(next))
        if (
          (path.endsWith('.md') &&
            !path.startsWith('output/') &&
            canvasId(matter(raw).data.canvas_id) === id) ||
          (isPreviewPath(path) &&
            !next[htmlSourcePath(path)] &&
            id === DEFAULT_CANVAS_ID)
        )
          paths.add(path);
    } else {
      if (
        !Array.isArray(input.paths) ||
        !input.paths.length ||
        input.paths.length > 500
      )
        throw new Error('이동할 자료를 선택해주세요.');
      for (const path of input.paths) {
        const raw = isPreviewPath(path)
          ? next[htmlSourcePath(path)]
          : next[path];
        if (canvasId(raw ? matter(raw).data.canvas_id : undefined) !== id)
          throw new Error(
            '자료가 다른 캔버스로 이동되었습니다. 다시 선택해주세요.',
          );
        paths.add(path);
      }
      // Moving a section includes every member. Moving one child detaches it.
      for (const path of paths)
        if (path.startsWith('sections/') && next[path])
          for (const member of matter(next[path]).data.members ?? [])
            paths.add(member.path);
      for (const [path, raw] of Object.entries(next)) {
        if (!path.startsWith('sections/') || paths.has(path)) continue;
        const parsed = matter(raw);
        const members = (parsed.data.members ?? []) as { path: string }[];
        const remaining = members.filter((member) => !paths.has(member.path));
        if (remaining.length !== members.length)
          next[path] = matter.stringify(parsed.content, {
            ...parsed.data,
            members: remaining,
          });
      }
    }
    for (const path of paths) assign(path, target);
    if (input.action === 'delete')
      sheets.canvases = sheets.canvases.filter((item) => item.id !== id);
  } else throw new Error('지원하지 않는 캔버스 작업입니다.');
  next[CANVAS_SHEETS_PATH] = JSON.stringify(sheets, null, 2) + '\n';
  validateCanvasMembership(next);
  return next;
}
