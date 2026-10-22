import type { MultiplayerSettings } from '../contracts/multiplayer.ts';
export type { MultiplayerSettings } from '../contracts/multiplayer.ts';
export type { PlayServerStatus } from '../contracts/multiplayer.ts';
export type { PlayLobbyUpdate } from '../contracts/multiplayer.ts';
export type { PlayLobbyEvent } from '../contracts/multiplayer.ts';
export type { PlayAction } from '../contracts/multiplayer.ts';
export type { PlayEnvelope } from '../contracts/multiplayer.ts';
export type { PlayRoom } from '../contracts/multiplayer.ts';
export type { MultiplayerManifest } from '../contracts/multiplayer.ts';
export type { PlayMember } from '../contracts/multiplayer.ts';
export type { PlayArtifact } from '../contracts/multiplayer.ts';
export const DEFAULT_MULTIPLAYER: MultiplayerSettings = {
  version: 1,
  authority: 'host',
  minPlayers: 2,
  maxPlayers: 2,
  sdkVersion: 1,
  solo: true,
};
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | {
      [key: string]: JsonValue;
    };
export type PlayMessage = {
  type: string;
  [key: string]: unknown;
};
