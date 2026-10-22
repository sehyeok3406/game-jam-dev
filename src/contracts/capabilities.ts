/** Platform abilities, independent of project roles and paid team access. */
export type ClientCapabilities = Readonly<{
  localFiles: boolean;
  localAiExecution: boolean;
  selfHostManagement: boolean;
  appUpdates: boolean;
  nativeClipboard: boolean;
  multiplayer: boolean;
}>;

export type ServiceMode = 'self-host' | 'managed-beta' | 'managed';

/** Resolved by the server; never inferred from a client capability. */
export type WorkspaceEntitlements = {
  workspaceId: string;
  version: number;
  teamCollaboration: boolean;
  storageBytes?: number;
  historyRetentionDays?: number;
};
