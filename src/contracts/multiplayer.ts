import type { PlayFailure } from './multiplayer-errors.ts';
export type MultiplayerSettings = {
  version: 1;
  authority: 'host';
  minPlayers: 2;
  maxPlayers: 2 | 3 | 4;
  sdkVersion: 1;
  solo: true;
};
export type PlayServerStatus = {
  version?: string;
  multiplayerVersion: number;
  multiplayerDiagnosticsVersion: number;
  multiplayerLobbyVersion: number;
};
export type PlayLobbyUpdate = PlayLobbyEvent & {
  projectId: string;
};
export type PlayLobbyEvent = {
  serverEpoch: string;
  revision: number;
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
  failure?: PlayFailure;
};
export type MultiplayerManifest = MultiplayerSettings & {
  stateVersion: 1;
};
export type PlayMember = {
  id: string;
  nickname: string;
  ready: boolean;
  loaded: boolean;
  connected: boolean;
};
export type PlayArtifact = {
  html: string;
  sourceHash: string;
  artifactId: string;
  sdkVersion: 1;
};
