const LIMIT = 200;
const key = (project: string, panel = false) =>
  (panel ? 'game-canvas-dismissed-ai-panel:' : 'game-canvas-dismissed-ai:') +
  project;
function read(
  storage: Pick<Storage, 'getItem'>,
  project: string,
  panel = false,
): string[] {
  try {
    const value: unknown = JSON.parse(
      storage.getItem(key(project, panel)) ?? '[]',
    );
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
  remember(storage, project, run);
}
function remember(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  project: string,
  run: string,
  panel = false,
) {
  const ids = read(storage, project, panel).filter((id) => id !== run);
  try {
    storage.setItem(
      key(project, panel),
      JSON.stringify([...ids, run].slice(-LIMIT)),
    );
  } catch {
    // The component also remembers dismissal for the current app session.
  }
}
export function runPanelDismissed(
  storage: Pick<Storage, 'getItem'>,
  project: string,
  run: string,
) {
  return read(storage, project, true).includes(run);
}
export function dismissRunPanel(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  project: string,
  run: string,
) {
  remember(storage, project, run, true);
  dismissCompletion(storage, project, run);
}
