import type { CardColor } from './card-colors.ts';
export type HtmlResultChoice = {
  mode: 'update' | 'new';
  basePath?: string;
  category?: ResultCategory;
};
export type ResultCategory = keyof typeof RESULT_CATEGORIES;
export const RESULT_CATEGORIES = {
  systems: '시스템',
  'ui-ux': 'UI·UX',
  content: '콘텐츠',
  prototypes: '통합 시제품',
  inbox: '미분류',
} as const;
export type PreviewResult = {
  propertyPreviousIds?: string[];
  statusPropertyEnabled?: boolean;
  placementId?: string;
  workflowStatusId?: string;
  workflowOrder?: number;
  canvasId?: string;
  previousPaths?: string[];
  revision?: number;
  backgroundColor?: CardColor;
  title?: string;
  sourceId?: string;
  sourcePath?: string;
  initialWindow?: PreviewWindowState;
  warnings?: string[];
  exists: boolean;
  content: string;
  relativePath: string;
};
export type PreviewWindowState = {
  placementId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
  /** Missing in older projects means free resize. */
  presetId?: string;
  freeSize?: {
    width: number;
    height: number;
  };
};
