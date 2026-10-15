import { createContext } from 'react';
import type { DrawingObject } from '../../drawing-types';
export type EraserPreview = Map<
  string,
  { generation: string; object?: DrawingObject }
>;
export const EraserPreviewContext = createContext<EraserPreview>(new Map());
