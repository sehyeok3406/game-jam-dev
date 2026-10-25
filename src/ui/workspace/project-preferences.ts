import type { WorkspaceState } from '../../contracts/project.ts';
import type { PreferenceStore } from '../runtime/preferences.ts';

export const projectPreferenceRoot = (workspace: WorkspaceState) =>
  workspace.libraryId ?? workspace.root;

/** Move legacy path preferences on first read; drafts and save queues retain their mode scope. */
export function readProjectPreference(
  preferences: PreferenceStore,
  prefix: string,
  workspace: WorkspaceState,
  suffix = '',
) {
  const key = prefix + projectPreferenceRoot(workspace) + suffix;
  const current = preferences.getItem(key);
  if (current !== null) return current;
  const previous = preferences.getItem(prefix + workspace.root + suffix);
  if (previous !== null) preferences.setItem(key, previous);
  return previous;
}
