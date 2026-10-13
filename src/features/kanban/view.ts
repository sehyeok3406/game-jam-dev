import type {
  DocumentStatuses,
  WorkflowStatus,
} from '../../document-statuses.ts';
export const KANBAN_VIEW_PATH = '.canvas/kanban-view.json';
export type KanbanView = {
  version: 1;
  backgrounds: Record<string, WorkflowStatus['boardBackground']>;
  orders: Record<string, number>;
};
export type KanbanViewInput = { expected: string | null; value: KanbanView };
export const defaultKanbanView = (): KanbanView => ({
  version: 1,
  backgrounds: {},
  orders: {},
});
export function validateKanbanView(value: unknown): KanbanView {
  const v = value as KanbanView;
  if (
    !v ||
    v.version !== 1 ||
    !v.backgrounds ||
    !v.orders ||
    Array.isArray(v.backgrounds) ||
    Array.isArray(v.orders) ||
    typeof v.backgrounds !== 'object' ||
    typeof v.orders !== 'object'
  )
    throw Error('칸반 보기 설정이 올바르지 않습니다.');
  if (
    Object.keys(v.orders).length > 500 ||
    Object.keys(v.backgrounds).length > 100
  )
    throw Error('칸반 보기 항목이 너무 많습니다.');
  const backgrounds = Object.fromEntries(
    Object.entries(v.backgrounds).map(([id, b]) => {
      if (
        !id ||
        !b ||
        !['status', 'none', 'custom'].includes(b.mode) ||
        (b.mode === 'custom' && !/^#[0-9a-fA-F]{6}$/.test(b.color))
      )
        throw Error('칸반 열 배경을 확인해주세요.');
      return [
        id,
        b.mode === 'custom'
          ? { mode: b.mode, color: b.color.toUpperCase() }
          : { mode: b.mode },
      ];
    }),
  ) as KanbanView['backgrounds'];
  for (const [id, order] of Object.entries(v.orders))
    if (!id || !Number.isFinite(order))
      throw Error('칸반 카드 순서가 올바르지 않습니다.');
  return { version: 1, backgrounds, orders: { ...v.orders } };
}
/** Legacy backgrounds are read through an adapter; new views own their appearance. */
export function readKanbanView(
  raw: string | null | undefined,
  statuses: DocumentStatuses,
): KanbanView {
  return raw == null
    ? {
        ...defaultKanbanView(),
        backgrounds: Object.fromEntries(
          statuses.statuses.map((s) => [s.id, s.boardBackground]),
        ),
      }
    : validateKanbanView(JSON.parse(raw));
}
export function kanbanOrder(view: KanbanView, id: string, legacy?: number) {
  return Object.hasOwn(view.orders, id) ? view.orders[id] : legacy;
}
export function kanbanBackground(view: KanbanView, status: WorkflowStatus) {
  return Object.hasOwn(view.backgrounds, status.id)
    ? view.backgrounds[status.id]
    : { mode: 'status' as const };
}
