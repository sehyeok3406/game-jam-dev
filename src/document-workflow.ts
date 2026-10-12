import matter from './markdown.ts';
import {
  DOCUMENT_STATUSES_PATH,
  readStatuses,
  validateStatuses,
  workflowCompare,
  type WorkflowInput,
  type StatusesInput,
} from './document-statuses.ts';
import type { Snapshot } from './project-store.ts';
import { htmlSourcePath, sourceMetadata } from './html-source.ts';
import { isPreviewPath } from './preview-output.ts';

export {
  workflowDocuments,
  assertWorkflowReferences,
  mergeStatuses,
} from './document-statuses-storage.ts';
import {
  workflowDocuments,
  assertWorkflowReferences,
} from './document-statuses-storage.ts';
const write = (
  files: Snapshot,
  path: string,
  status: string,
  order?: number,
) => {
  const parsed = matter(files[path]);
  parsed.data.workflow_status_id = status;
  if (order !== undefined) parsed.data.workflow_order = order;
  parsed.data.updated_at = Date.now();
  files[path] = matter.stringify(parsed.content, parsed.data);
};
export function applyWorkflow(files: Snapshot, input: WorkflowInput): Snapshot {
  const next = { ...files };
  if (isPreviewPath(input.relativePath)) {
    const relative = input.relativePath;
    if (!files[relative]) throw Error('HTML 원본을 찾을 수 없습니다.');
    const path = htmlSourcePath(relative);
    if (!next[path]) next[path] = sourceMetadata(relative, files[relative]);
    input = { ...input, relativePath: path };
  }
  const docs = workflowDocuments(next),
    doc = docs.find((d) => d.path === input.relativePath);
  if (!doc || doc.id !== input.objectId)
    throw Error('문서가 변경되었거나 삭제되었습니다.');
  if (
    doc.workflowStatusId !== input.expectedStatus ||
    doc.workflowOrder !== input.expectedOrder
  )
    throw Error('문서 상태가 변경되었습니다. 최신 상태에서 다시 선택해주세요.');
  const statuses = readStatuses(next[DOCUMENT_STATUSES_PATH]);
  if (!statuses.statuses.some((s) => s.id === input.statusId))
    throw Error('대상 상태가 삭제되었습니다.');
  const column = docs
    .filter(
      (d) =>
        d.id !== doc.id &&
        (d.workflowStatusId ?? 'not-started') === input.statusId,
    )
    .sort(workflowCompare);
  let index = column.length;
  if (input.beforeId) index = column.findIndex((d) => d.id === input.beforeId);
  else if (input.afterId) {
    const i = column.findIndex((d) => d.id === input.afterId);
    index = i < 0 ? -1 : i + 1;
  }
  if (index < 0) throw Error('삽입 기준 문서가 변경되었습니다.');
  if (column.some((d) => d.workflowOrder === undefined))
    column.forEach((d, i) => {
      d.workflowOrder = (i + 1) * 1024;
      write(next, d.path, input.statusId, d.workflowOrder);
    });
  let left = index === 0 ? 0 : column[index - 1].workflowOrder!,
    right = column[index]?.workflowOrder ?? left + 2048;
  if (right - left < 0.000001 || !Number.isFinite(right)) {
    column.forEach((d, i) => {
      d.workflowOrder = (i + 1) * 1024;
      write(next, d.path, input.statusId, d.workflowOrder);
    });
    left = index === 0 ? 0 : column[index - 1].workflowOrder!;
    right = column[index]?.workflowOrder ?? left + 2048;
  }
  next[DOCUMENT_STATUSES_PATH] ??= JSON.stringify(statuses, null, 2);
  write(next, doc.path, input.statusId, (left + right) / 2);
  assertWorkflowReferences(next, files);
  return next;
}
export function saveStatuses(files: Snapshot, input: StatusesInput): Snapshot {
  if ((files[DOCUMENT_STATUSES_PATH] ?? null) !== input.expected)
    throw Error('상태 설정이 변경되었습니다. 최신 설정을 다시 열어주세요.');
  const value = validateStatuses(input.value),
    next = { ...files };
  const ids = new Set(value.statuses.map((s) => s.id));
  for (const doc of workflowDocuments(files)) {
    const id = doc.workflowStatusId ?? 'not-started';
    if (ids.has(id)) continue;
    const replacement = input.replacements?.[id];
    if (!replacement || !ids.has(replacement))
      throw Error('사용 중인 상태를 삭제하려면 대체 상태를 선택해주세요.');
    write(next, doc.path, replacement, Date.now());
  }
  next[DOCUMENT_STATUSES_PATH] = JSON.stringify(value, null, 2);
  assertWorkflowReferences(next, files);
  return next;
}
export function initializeWorkflows(
  before: Snapshot,
  after: Snapshot,
  preserve = false,
): Snapshot {
  const next = { ...after },
    statuses = readStatuses(after[DOCUMENT_STATUSES_PATH]);
  for (const doc of workflowDocuments(after)) {
    const old = before[doc.path] ? matter(before[doc.path]) : null;
    if (preserve && old) {
      const parsed = matter(next[doc.path]);
      for (const key of ['workflow_status_id', 'workflow_order']) {
        if (old.data[key] === undefined) delete parsed.data[key];
        else parsed.data[key] = old.data[key];
      }
      if (next[doc.path] !== before[doc.path])
        next[doc.path] = matter.stringify(parsed.content, parsed.data);
    } else if (!old && after[DOCUMENT_STATUSES_PATH]) {
      write(
        next,
        doc.path,
        doc.workflowStatusId &&
          statuses.statuses.some((s) => s.id === doc.workflowStatusId)
          ? doc.workflowStatusId
          : statuses.defaultStatusId,
        Date.now(),
      );
    }
  }
  return next;
}
