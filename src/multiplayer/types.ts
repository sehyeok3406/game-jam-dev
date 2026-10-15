export type MultiplayerSettings = {
  version: 1;
  authority: 'host';
  minPlayers: 2;
  maxPlayers: 2 | 3 | 4;
  sdkVersion: 1;
  solo: true;
};
export const DEFAULT_MULTIPLAYER: MultiplayerSettings = {
  version: 1,
  authority: 'host',
  minPlayers: 2,
  maxPlayers: 2,
  sdkVersion: 1,
  solo: true,
};
export type MultiplayerManifest = MultiplayerSettings & { stateVersion: 1 };
export type PlayMember = {
  id: string;
  nickname: string;
  ready: boolean;
  loaded: boolean;
  connected: boolean;
};
export type PlayRoom = {
  id: string;
  serverEpoch: string;
  revision: number;
  path: string;
  title: string;
  sourceHash: string;
  artifactId: string;
  manifest: MultiplayerManifest;
  hostId: string;
  members: PlayMember[];
  status: 'lobby' | 'loading' | 'running' | 'paused' | 'finished' | 'closed';
  matchId: string | null;
  seed: number;
  reason?: string;
  failure?: import('./errors.ts').PlayFailure;
};
export type PlayArtifact = {
  html: string;
  sourceHash: string;
  artifactId: string;
  sdkVersion: 1;
};
export type PlayAction = {
  action: 'list' | 'create' | 'join' | 'leave' | 'ready' | 'start' | 'artifact';
  roomId?: string;
  path?: string;
  sourceHash?: string;
  requestId?: string;
  ready?: boolean;
  expectedRevision?: number;
};
export type PlayEnvelope = {
  room?: PlayRoom;
  rooms?: PlayRoom[];
  artifact?: PlayArtifact;
};
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export type PlayMessage = { type: string; [key: string]: unknown };
