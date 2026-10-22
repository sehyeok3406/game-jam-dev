export type DocumentResultChoice = {
  mode: 'new' | 'update';
  baseDir?: string;
  structure?: 'systems' | 'legacy' | 'custom';
  documents?: DocumentOutputTemplate[];
};
export type DocumentOutputTemplate = {
  key: string;
  title: string;
  type: 'overview' | 'system' | 'question';
  instructions: string;
};
