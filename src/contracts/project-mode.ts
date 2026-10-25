import type { Snapshot } from './project.ts';
import type { FileAuthorshipMap } from './documents.ts';

export type CreateProjectInput = {
  name: string;
  requestId?: string;
  mode: 'local' | 'shared';
  parent?: string;
  serverUrl?: string;
  serverKey?: string;
  nickname?: string;
};
export type LocalConversionInput = { parent?: string; successorId?: string };
export type ProjectHandover = {
  id: string;
  from: string;
  to: string;
  accepted: boolean;
};
export type ModeSnapshot = {
  files: Snapshot;
  authorship: FileAuthorshipMap;
  name: string;
  stamp: string;
};
export type DetachInput = {
  id: string;
  proof: string;
  stamp: string;
  successorId?: string;
};
export type CreationIdentity = {
  id: string;
  token: string;
  recoveryKey: string;
  inviteCode: string;
};
