import type { CollaborationRole } from './collaboration.ts';
export type WorkspaceState = {
  session?: import('./project-session.ts').ProjectSessionRef;
  root: string | null;
  name: string | null;
  saveScope?: string;
  clipboardContextId?: string;
};
export type ProjectEntry = {
  lifecycle?: SharedProjectLifecycle;
  id: string;
  name: string;
  kind: 'local' | 'shared';
  root?: string;
  serverUrl?: string;
  projectId?: string;
  role?: CollaborationRole;
  lastOpenedAt: number;
  createdAt?: number;
  modifiedAt?: number;
  connected?: boolean;
  pendingChanges?: number;
  current?: boolean;
  folderId?: string;
};
export type SharedProjectLifecycle = {
  projectId: string;
  name?: string;
  status:
    | 'active'
    | 'trashing'
    | 'trashed'
    | 'restoring'
    | 'purging'
    | 'purged';
  version: number;
  expiresAt?: number;
  error?: string;
};
export type ProjectTrashEntry = {
  trashId: string;
  projectId: string;
  name: string;
  kind: 'local' | 'shared';
  originalPath: string;
  trashedAt?: number;
  expiresAt?: number;
  stage: 'moving' | 'retained' | 'restoring' | 'purging';
  error?: string;
  pendingWork: boolean;
  storage: Record<string, string>;
};
/** Home-only grouping; never a filesystem or server directory. */
export type ProjectFolder = {
  id: string;
  name: string;
};
export type Snapshot = Record<string, string>;
