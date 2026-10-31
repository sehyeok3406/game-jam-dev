export type SharedWorkspaceEntry = {
  id: string;
  name: string;
  projectId?: string;
  serverUrl?: string;
  sharedRoot?: string;
};
export type SharedWorkspaceRegistry = {
  get(id: string): SharedWorkspaceEntry;
  setRoot(id: string, root: string): Promise<void>;
  assertName(name: string, exceptId: string): void;
};
