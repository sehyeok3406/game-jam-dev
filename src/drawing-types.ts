export type { DrawingItem } from './contracts/drawing-types.ts';
import type { DrawingObject } from './contracts/drawing-types.ts';
export type { DrawingObject } from './contracts/drawing-types.ts';
export type { ShapeObject } from './contracts/drawing-types.ts';
export type { DrawingBase } from './contracts/drawing-types.ts';
export type { DrawingTransform } from './contracts/drawing-types.ts';
export type { DrawingStyle } from './contracts/drawing-types.ts';
import type { ShapeKind } from './contracts/drawing-types.ts';
export type { ShapeKind } from './contracts/drawing-types.ts';
export type { StrokeObject } from './contracts/drawing-types.ts';
export type { DrawingChanges } from './contracts/drawing-types.ts';
export type { DrawingCommand } from './contracts/drawing-types.ts';
export type { DrawingPatch } from './contracts/drawing-types.ts';
export type { DrawingDelta } from './contracts/drawing-types.ts';
export type DrawingTool = ShapeKind | 'pen' | 'highlighter' | 'eraser';
export type DrawingFile = {
  version: 1;
  canvasId: string;
  objects: DrawingObject[];
};
export const SHAPE_NAMES: Record<ShapeKind, string> = {
  rectangle: '사각형',
  'rounded-rectangle': '둥근 사각형',
  ellipse: '원 · 타원',
  triangle: '삼각형',
  diamond: '마름모',
  line: '선',
  arrow: '화살표',
};
export const drawingName = (object: DrawingObject) =>
  object.kind === 'shape'
    ? SHAPE_NAMES[object.geometry.shape]
    : object.geometry.brush === 'pen'
      ? '펜 획'
      : '형광펜 획';
