import type { ProjectSessionRef } from './project-session.ts';
import type { WorkspaceState } from './project.ts';

export type LocationTarget = {
  kind: 'document' | 'file' | 'html' | 'drawing';
  id: string;
  blockId?: string;
};
export type LocationLink = {
  version: 1;
  projectId: string;
  target: LocationTarget;
};
export type LocationItem = {
  target: LocationTarget;
  canvasId: string;
  documentId?: string;
  relativePath?: string;
  previewIdentityPath?: string;
  blockIds?: string[];
  blockMissing?: boolean;
};
export type LocationOpenResult = {
  workspace: WorkspaceState;
  item: LocationItem;
};
export type LocationLinksApi = {
  create(target: LocationTarget, session: ProjectSessionRef): Promise<string>;
  open(
    href: string,
    session: ProjectSessionRef | null,
    projectEntryId?: string,
  ): Promise<LocationOpenResult>;
  pending(): Promise<{ id: number; href: string } | null>;
  acknowledge(id: number): Promise<void>;
  onReceived(listener: () => void): () => void;
};
