import type { GameCanvasApi } from '../../contracts/app-api.ts';
import type {
  ProjectEntry,
  ProjectFolder,
  WorkspaceState,
  SharedProjectLifecycle,
} from '../../contracts/project.ts';

/** Public registry view. Credentials belong to the desktop adapter. */
export interface HomeProjectRegistry {
  list(): ProjectEntry[];
  withName?<T>(
    name: string,
    exceptId: string | undefined,
    operation: () => Promise<T>,
  ): Promise<T>;
  assertNameAvailable?(name: string, exceptId?: string): void;
  observeName?(
    id: string,
    name: string,
    role?: ProjectEntry['role'],
  ): Promise<void>;
  get(id: string): ProjectEntry;
  hasSharedSession(id: string): boolean;
  findShared?(projectId: string, serverUrl?: string): ProjectEntry;
  listFolders(): ProjectFolder[];
  renameProject(
    id: string,
    name: string,
    role?: ProjectEntry['role'],
  ): Promise<void>;
  updateServer(id: string, url: string): Promise<void>;
  moveProject(id: string, folder: string | null): Promise<void>;
  createFolder(name: string): Promise<void>;
  renameFolder(id: string, name: string): Promise<void>;
  removeFolder(id: string): Promise<void>;
}
export interface HomeLocalProjects {
  name(root: string): Promise<string>;
  timestamps(
    root: string,
  ): Promise<Pick<ProjectEntry, 'createdAt' | 'modifiedAt'>>;
  rename(root: string, name: string, expectedName?: string): Promise<void>;
  directory(root: string): Promise<string>;
  create(parent: string, name: string): Promise<string>;
}
export type SharedLifecycleAction =
  | 'lifecycle'
  | 'trash'
  | 'trash-restore'
  | 'trash-purge';
export interface HomeSharedProjects {
  directory?(id: string): Promise<{ root: string; offline: boolean }>;
  cache(
    id: string,
  ): Promise<
    Pick<ProjectEntry, 'pendingChanges' | 'role' | 'createdAt' | 'modifiedAt'>
  >;
  lifecycle(
    id: string,
    action: SharedLifecycleAction,
    input?: object,
  ): Promise<SharedProjectLifecycle>;
  metadata(
    id: string,
  ): Promise<Pick<ProjectEntry, 'name' | 'role' | 'createdAt' | 'modifiedAt'>>;
  rename(
    id: string,
    name: string,
    expectedName: string,
  ): Promise<{ name: string; role: ProjectEntry['role'] }>;
}
export type HomeProjectTrash = {
  hasProject(id: string): boolean;
  prepare: GameCanvasApi['prepareProjectTrash'];
  list: GameCanvasApi['listProjectTrash'];
  trash: GameCanvasApi['trashProject'];
  restore: GameCanvasApi['restoreProjectTrash'];
  acknowledgeRestore: GameCanvasApi['acknowledgeProjectRestore'];
  purge: GameCanvasApi['purgeProjectTrash'];
  maintain: GameCanvasApi['retryProjectTrash'];
};
export interface HomeProjectSession {
  current(): { root: string | null; sharedId?: string; connected?: boolean };
  workspace(): WorkspaceState | Promise<WorkspaceState>;
  suspend(): Promise<void>;
  openLocal(root: string): Promise<WorkspaceState>;
  openShared(id: string): Promise<WorkspaceState>;
  checkHost(): Promise<void>;
}
