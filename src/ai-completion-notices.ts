const LIMIT = 200;
const key = (project: string) => 'game-canvas-dismissed-ai:' + project;
function read(storage: Pick<Storage, 'getItem'>, project: string): string[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(key(project)) ?? '[]');
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string').slice(-LIMIT)
      : [];
  } catch {
    return [];
  }
}
export function completionDismissed(
  storage: Pick<Storage, 'getItem'>,
  project: string,
  run: string,
) {
  return read(storage, project).includes(run);
}
export function dismissCompletion(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  project: string,
  run: string,
) {
  const ids = read(storage, project).filter((id) => id !== run);
  try {
    storage.setItem(key(project), JSON.stringify([...ids, run].slice(-LIMIT)));
  } catch {
    // The component also remembers dismissal for the current app session.
  }
}
