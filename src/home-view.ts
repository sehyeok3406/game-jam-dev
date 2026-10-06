import type { ProjectEntry } from './shared.ts';

export type HomeView = {
  filter: 'all' | 'local' | 'shared';
  sortBy: 'name' | 'created' | 'modified' | 'opened';
  direction: 'asc' | 'desc';
  view: 'grid' | 'list';
};
export const DEFAULT_HOME_VIEW: HomeView = {
  filter: 'all',
  sortBy: 'modified',
  direction: 'desc',
  view: 'grid',
};
export const HOME_VIEW_KEY = 'game-canvas-home-view';

export function readHomeView(raw: string | null): HomeView {
  let value: Partial<HomeView>;
  try {
    value = JSON.parse(raw ?? '{}');
  } catch {
    return { ...DEFAULT_HOME_VIEW };
  }
  if (!value || typeof value !== 'object') return { ...DEFAULT_HOME_VIEW };
  return {
    filter:
      value.filter === 'local' || value.filter === 'shared'
        ? value.filter
        : 'all',
    sortBy: ['name', 'created', 'modified', 'opened'].includes(
      value.sortBy ?? '',
    )
      ? value.sortBy!
      : DEFAULT_HOME_VIEW.sortBy,
    direction: value.direction === 'asc' ? 'asc' : 'desc',
    view: value.view === 'list' ? 'list' : 'grid',
  };
}

export const homeDateLabel = (sortBy: HomeView['sortBy']) =>
  sortBy === 'created'
    ? '생성일'
    : sortBy === 'opened'
      ? '최근 열기'
      : '마지막 수정';
export function homeDate(entry: ProjectEntry, sortBy: HomeView['sortBy']) {
  const value =
    sortBy === 'created'
      ? entry.createdAt
      : sortBy === 'opened'
        ? entry.lastOpenedAt
        : entry.modifiedAt;
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    Number.isFinite(new Date(value).getTime())
    ? value
    : undefined;
}

export function selectHomeProjects(
  projects: ProjectEntry[],
  settings: HomeView,
  query: string,
  folderId: string | null,
) {
  const needle = query.trim().toLocaleLowerCase();
  const collator = new Intl.Collator('ko-KR', {
    numeric: true,
    sensitivity: 'base',
  });
  const sign = settings.direction === 'asc' ? 1 : -1;
  return projects
    .filter(
      (entry) =>
        (settings.filter === 'all' || entry.kind === settings.filter) &&
        (!folderId || entry.folderId === folderId) &&
        `${entry.name} ${entry.root ?? ''} ${entry.serverUrl ?? ''}`
          .toLocaleLowerCase()
          .includes(needle),
    )
    .sort((a, b) => {
      if (settings.sortBy === 'name') {
        const difference = collator.compare(a.name, b.name);
        if (difference) return sign * difference;
      } else {
        const left = homeDate(a, settings.sortBy),
          right = homeDate(b, settings.sortBy);
        if (left === undefined && right !== undefined) return 1;
        if (right === undefined && left !== undefined) return -1;
        if (left !== undefined && right !== undefined && left !== right)
          return sign * (left - right);
      }
      return collator.compare(a.name, b.name) || collator.compare(a.id, b.id);
    });
}
