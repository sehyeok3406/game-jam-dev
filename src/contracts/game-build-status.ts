export type GameBuildStatus = {
  kind: 'source' | 'html' | 'unavailable';
  buildId?: string;
  libraries: { name: string; version: string }[];
  documents: {
    path: string;
    title: string;
    state: 'unchanged' | 'changed' | 'missing' | 'replaced' | 'unknown';
  }[];
  message?: string;
};
