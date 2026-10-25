import type { GameCanvasApi } from '../../contracts/app-api.ts';
import type {
  CollaborationState,
  CollaborationRole,
} from '../../contracts/collaboration.ts';
import type { Snapshot } from '../../contracts/project.ts';

export type ConnectionScope = {
  root: string | null;
  shared: boolean;
  localRoot: string | null;
  assertCurrent(): void;
};
/** Authenticated credentials stay inside the desktop implementation of this offer. */
export type ConnectionOffer = {
  activate(localRoot: string | null): Promise<CollaborationState>;
  retain(localRoot: string | null): Promise<void>;
};
export type ActiveCollaboration = {
  assertCurrent(): void;
  backupOffline(): Promise<void>;
  resolve(id: string, choice: 'local' | 'server'): Promise<void>;
  resume(): Promise<void>;
  invite(): Promise<CollaborationState>;
  persist(): Promise<void>;
  role(id: string, role: CollaborationRole | 'removed'): Promise<void>;
  lock(path: string): Promise<void>;
  unlock(path: string): Promise<void>;
};
export interface CollaborationSessionPort {
  scope(): ConnectionScope;
  state(): CollaborationState;
  active(): ActiveCollaboration | null;
  busy(): boolean;
  assertSecure(): void;
  source(
    root: string,
    assertCurrent: () => void,
  ): Promise<{ name: string; files: Snapshot }>;
  create(
    input: Parameters<GameCanvasApi['createCollaboration']>[0],
    source: { name: string; files: Snapshot },
  ): Promise<ConnectionOffer>;
  join(
    input: Parameters<GameCanvasApi['joinCollaboration']>[0],
  ): Promise<ConnectionOffer>;
  recover(
    input: Parameters<GameCanvasApi['recoverCollaboration']>[0],
  ): Promise<ConnectionOffer>;
  suspend(): Promise<void>;
  leave(): Promise<void>;
  toLocal?(
    input: import('../../contracts/project-mode.ts').LocalConversionInput,
  ): Promise<void>;
  handover?(
    action: 'prepare' | 'accept' | 'cancel',
    successorId?: string,
  ): Promise<void>;
  prepareLock(path: string): Promise<void>;
}
