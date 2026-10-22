import type { KanbanMoveInput } from '../../contracts/kanban.ts';
export type { KanbanMoveInput } from '../../contracts/kanban.ts';
import type { Snapshot } from '../../project-store.ts';
import {
  readStatuses,
  DOCUMENT_STATUSES_PATH,
  workflowCompare,
} from '../../document-statuses.ts';
import { workflowDocuments } from '../../document-statuses-storage.ts';
import { applyStatusProperty } from '../../document-workflow.ts';
import { statusPropertyApplied } from '../../file-properties.ts';
import { htmlSourcePath } from '../../html-source.ts';
import { isPreviewPath } from '../../preview-output.ts';
import {
  KANBAN_VIEW_PATH,
  readKanbanView,
  validateKanbanView,
  kanbanOrder,
  type KanbanViewInput,
} from './view.ts';
export function saveKanbanView(
  files: Snapshot,
  input: KanbanViewInput,
): Snapshot {
  if ((files[KANBAN_VIEW_PATH] ?? null) !== input.expected)
    throw Error('칸반 보기 설정이 변경되었습니다. 다시 열어주세요.');
  return {
    ...files,
    [KANBAN_VIEW_PATH]: JSON.stringify(
      validateKanbanView(input.value),
      null,
      2,
    ),
  };
}
export function moveKanbanCard(
  files: Snapshot,
  input: KanbanMoveInput,
  now: () => number = Date.now,
): Snapshot {
  if ((files[KANBAN_VIEW_PATH] ?? null) !== input.expectedView)
    throw Error('칸반 순서가 변경되었습니다. 다시 시도해주세요.');
  const path = isPreviewPath(input.relativePath)
    ? htmlSourcePath(input.relativePath)
    : input.relativePath;
  const original = workflowDocuments(files).find((d) => d.path === path);
  // An HTML file without metadata is a legacy applied file.
  if (original && !statusPropertyApplied(original))
    throw Error('상태 속성이 미적용인 파일은 칸반에서 이동할 수 없습니다.');
  if (input.expectedEnabled !== true || input.enabled === false)
    throw Error('상태 속성 적용을 먼저 확인해주세요.');
  const next = applyStatusProperty(files, input, now);
  const statuses = readStatuses(next[DOCUMENT_STATUSES_PATH]);
  const view = readKanbanView(files[KANBAN_VIEW_PATH], statuses);
  const docs = workflowDocuments(next).filter(statusPropertyApplied);
  // Capture legacy ordering once without rewriting other files.
  for (const d of docs)
    if (d.workflowOrder !== undefined && !Object.hasOwn(view.orders, d.id))
      view.orders[d.id] = d.workflowOrder;
  const column = docs
    .filter(
      (d) =>
        d.id !== input.objectId &&
        (d.workflowStatusId ?? 'not-started') === input.statusId,
    )
    .map((d) => ({
      ...d,
      workflowOrder: kanbanOrder(view, d.id, d.workflowOrder),
    }))
    .sort(workflowCompare);
  let index = column.length;
  if (input.beforeId) index = column.findIndex((d) => d.id === input.beforeId);
  else if (input.afterId) {
    const i = column.findIndex((d) => d.id === input.afterId);
    index = i < 0 ? -1 : i + 1;
  }
  if (index < 0) throw Error('삽입 기준 파일이 변경되었습니다.');
  if (column.some((d) => d.workflowOrder === undefined))
    column.forEach((d, i) => {
      d.workflowOrder = (i + 1) * 1024;
      view.orders[d.id] = d.workflowOrder;
    });
  let left = index === 0 ? 0 : column[index - 1].workflowOrder!,
    right = column[index]?.workflowOrder ?? left + 2048;
  if (right - left < 0.000001 || !Number.isFinite(right)) {
    column.forEach((d, i) => {
      d.workflowOrder = (i + 1) * 1024;
      view.orders[d.id] = d.workflowOrder;
    });
    left = index === 0 ? 0 : column[index - 1].workflowOrder!;
    right = column[index]?.workflowOrder ?? left + 2048;
  }
  const activeIds = new Set(workflowDocuments(next).map((d) => d.id));
  view.orders = Object.fromEntries(
    Object.entries(view.orders).filter(([id]) => activeIds.has(id)),
  );
  view.orders[input.objectId] = (left + right) / 2;
  next[KANBAN_VIEW_PATH] = JSON.stringify(view, null, 2);
  return next;
}
