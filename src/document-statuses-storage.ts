import matter from './markdown.ts';
import { DOCUMENT_STATUSES_PATH, readStatuses } from './document-statuses.ts';
import type { Snapshot } from './project-store.ts';
import { statusPropertyApplied } from './file-properties.ts';
export function workflowDocuments(files: Snapshot) {
  return Object.entries(files).flatMap(([path, raw]) => {
    if (
      !path.endsWith('.md') ||
      path.startsWith('.ai/') ||
      path.startsWith('sections/') ||
      path.startsWith('output/')
    )
      return [];
    const { data } = matter(raw);
    if (data.type === 'ai-task') return [];
    return [
      {
        id: String(data.id ?? path),
        path,
        statusPropertyEnabled: data.status_property_enabled as
          | boolean
          | undefined,
        workflowStatusId: data.workflow_status_id as string | undefined,
        workflowOrder: data.workflow_order as number | undefined,
      },
    ];
  });
}
export function assertWorkflowReferences(files: Snapshot, previous?: Snapshot) {
  const statuses = readStatuses(files[DOCUMENT_STATUSES_PATH]);
  const ids = new Set(statuses.statuses.map((s) => s.id));
  for (const d of workflowDocuments(files)) {
    if (
      d.statusPropertyEnabled !== undefined &&
      typeof d.statusPropertyEnabled !== 'boolean'
    )
      throw Error('상태 속성 적용 여부가 올바르지 않습니다.');
    if (
      statusPropertyApplied(d) &&
      !ids.has(d.workflowStatusId ?? 'not-started') &&
      (!previous || previous[d.path] !== files[d.path])
    )
      throw Error(`존재하지 않는 문서 상태를 먼저 복구해주세요: ${d.path}`);
    if (d.workflowOrder !== undefined && !Number.isFinite(d.workflowOrder))
      throw Error('보드 순서가 올바르지 않습니다.');
  }
}
export function mergeStatuses(
  expected: string | undefined,
  desired: string | undefined,
  current: string | undefined,
) {
  if (current === expected || current === desired) return desired;
  throw Error('상태 설정의 이후 변경과 충돌하여 되돌리기를 중단했습니다.');
}
