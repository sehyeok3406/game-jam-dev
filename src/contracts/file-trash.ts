export const TRASH_RETENTION = 7 * 24 * 60 * 60 * 1000;

export type FileTrashEntry = {
  id: string;
  projectId: string;
  projectName: string;
  files: { path: string; name: string }[];
  expiresAt: number;
};
