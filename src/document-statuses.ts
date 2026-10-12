export const DOCUMENT_STATUSES_PATH = '.canvas/document-statuses.json';
export type WorkflowStatus = {
  id: string;
  name: string;
  badgeColor: string;
  boardBackground:
    | { mode: 'status' | 'none' }
    | { mode: 'custom'; color: string };
};
export type DocumentStatuses = {
  version: 1;
  defaultStatusId: string;
  statuses: WorkflowStatus[];
};
export type WorkflowInput = {
  relativePath: string;
  objectId: string;
  expectedStatus?: string;
  expectedOrder?: number;
  structureRevision?: number;
  workflowRevision?: number;
  statusId: string;
  beforeId?: string;
  afterId?: string;
};
export type StatusesInput = {
  expected: string | null;
  value: DocumentStatuses;
  replacements?: Record<string, string>;
};
export const defaultStatuses = (): DocumentStatuses => ({
  version: 1,
  defaultStatusId: 'not-started',
  statuses: [
    {
      id: 'not-started',
      name: '시작 전',
      badgeColor: '#6B7280',
      boardBackground: { mode: 'status' },
    },
    {
      id: 'in-progress',
      name: '진행 중',
      badgeColor: '#3B82F6',
      boardBackground: { mode: 'status' },
    },
    {
      id: 'done',
      name: '완료',
      badgeColor: '#22C55E',
      boardBackground: { mode: 'status' },
    },
  ],
});
export function validateStatuses(value: unknown): DocumentStatuses {
  if (!value || typeof value !== 'object')
    throw Error('상태 설정이 올바르지 않습니다.');
  const v = value as DocumentStatuses;
  if (
    v.version !== 1 ||
    !Array.isArray(v.statuses) ||
    !v.statuses.length ||
    v.statuses.length > 50
  )
    throw Error('상태는 1~50개까지 사용할 수 있습니다.');
  const ids = new Set<string>(),
    names = new Set<string>();
  const color = (c: unknown) => {
    if (typeof c !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(c))
      throw Error('색상은 #RRGGBB 형식으로 지정해주세요.');
    return c.toUpperCase();
  };
  const statuses = v.statuses.map((s) => {
    if (
      !s ||
      typeof s.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(s.id) ||
      ids.has(s.id)
    )
      throw Error('상태 ID가 올바르지 않거나 중복되었습니다.');
    const name = typeof s.name === 'string' ? s.name.trim() : '';
    const key = name.normalize('NFKC').toLocaleLowerCase();
    if (
      !name ||
      name.length > 40 ||
      [...name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
      names.has(key)
    )
      throw Error('상태 이름은 중복 없는 1~40자로 입력해주세요.');
    if (
      !s.boardBackground ||
      !['status', 'none', 'custom'].includes(s.boardBackground.mode)
    )
      throw Error('열 배경 설정이 올바르지 않습니다.');
    ids.add(s.id);
    names.add(key);
    const boardBackground: WorkflowStatus['boardBackground'] =
      s.boardBackground.mode === 'custom'
        ? { mode: 'custom', color: color(s.boardBackground.color) }
        : { mode: s.boardBackground.mode };
    return { id: s.id, name, badgeColor: color(s.badgeColor), boardBackground };
  });
  if (!ids.has(v.defaultStatusId))
    throw Error('새 문서의 기본 상태를 선택해주세요.');
  return { version: 1, defaultStatusId: v.defaultStatusId, statuses };
}
export function readStatuses(raw?: string | null): DocumentStatuses {
  if (raw === undefined || raw === null) return defaultStatuses();
  try {
    return validateStatuses(JSON.parse(raw));
  } catch (error) {
    throw Error(
      `상태 설정을 복구해주세요: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
export function workflowId(document: { workflowStatusId?: string }) {
  return document.workflowStatusId ?? 'not-started';
}
export const workflowCompare = (
  a: { id: string; workflowOrder?: number },
  b: { id: string; workflowOrder?: number },
) =>
  (a.workflowOrder ?? Number.MAX_VALUE) -
    (b.workflowOrder ?? Number.MAX_VALUE) || a.id.localeCompare(b.id);
export function statusForeground(color: string) {
  const rgb = color
    .slice(1)
    .match(/../g)
    ?.map((c) => parseInt(c, 16) / 255) ?? [0, 0, 0];
  const linear = rgb.map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  const luminance =
    linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05)
    ? '#000000'
    : '#FFFFFF';
}
