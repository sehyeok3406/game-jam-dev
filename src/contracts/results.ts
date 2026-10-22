import type { ResultCategory } from './preview.ts';
export type MoveResultInput = {
  relativePath: string;
  category: ResultCategory;
  feature: string;
  revision?: number;
};
export type ResultMove = {
  from: string;
  to: string;
};
