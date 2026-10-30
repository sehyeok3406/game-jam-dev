/** Logical snapshot keys stay stable; the filesystem adapter owns their physical locations. */
export const PROJECT_LAYOUT_PATH = '.canvas/layout.json';
export const PROJECT_LAYOUT_VERSION = 2;
export type ProjectLayout = {
  version: 2;
  aliases: Record<string, string>;
};
export type ProjectLayoutStatus = {
  session?: import('./project-session.ts').ProjectSessionRef;
  version: 1 | 2;
  canUpgrade: boolean;
  reason?: string;
};
