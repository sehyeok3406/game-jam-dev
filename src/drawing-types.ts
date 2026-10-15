export type ShapeKind =
  | 'rectangle'
  | 'rounded-rectangle'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'line'
  | 'arrow';
export type DrawingTool = ShapeKind | 'pen' | 'highlighter' | 'eraser';
export type EraserMode = 'stroke' | 'partial';
export type DrawingPolygon = [number, number][][];
export type ErasureRegion = { id: string; polygons: DrawingPolygon[] };
export type DrawingTransform = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};
export type DrawingStyle = {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  opacity: number;
  strokePattern: 'solid' | 'dashed';
};
export type DrawingBase = {
  id: string;
  generation: string;
  transform: DrawingTransform;
  style: DrawingStyle;
  layer: 'background' | 'annotation';
  order: number;
  createdAt: number;
  updatedAt: number;
};
export type ShapeObject = DrawingBase & {
  kind: 'shape';
  geometry: {
    shape: ShapeKind;
    cornerRadius?: number;
    endpoints?: [[number, number], [number, number]];
  };
};
export type StrokeObject = DrawingBase & {
  kind: 'stroke';
  geometry: {
    brush: 'pen' | 'highlighter';
    sourceWidth: number;
    sourceHeight: number;
    points: [number, number, number][];
    pressureEnabled: boolean;
    rendererVersion: 1;
    erasures?: ErasureRegion[];
  };
};
export type DrawingObject = ShapeObject | StrokeObject;
export type DrawingFile = {
  version: 1 | 2;
  canvasId: string;
  objects: DrawingObject[];
};
export type DrawingItem = DrawingObject & { canvasId: string };
export type DrawingChanges = {
  changed: DrawingItem[];
  removed: string[];
  signatures: Record<string, string>;
};
export type DrawingDelta = {
  version?: 1 | 2;
  canvasId: string;
  upsert: DrawingObject[];
  removed: string[];
  deleted: boolean;
};
export type DrawingPatch = {
  id: string;
  generation: string;
  transform?: Partial<DrawingTransform>;
  style?: Partial<DrawingStyle>;
  layer?: DrawingObject['layer'];
  order?: number;
  geometry?: DrawingObject['geometry'];
  expectedGeometry?: DrawingObject['geometry'];
};
export type DrawingCommand = {
  scope?: string;
  requestId?: string;
  canvasId: string;
  action: 'create' | 'patch' | 'delete' | 'move' | 'erase';
  erasures?: DrawingErasure[];
  objects?: DrawingObject[];
  patches?: DrawingPatch[];
  targets?: { id: string; generation: string }[];
  targetCanvasId?: string;
};
export type DrawingErasure = {
  id: string;
  generation: string;
  expectedTransform: DrawingTransform;
  expectedGeometry: StrokeObject['geometry'];
  expectedStrokeWidth: number;
  region: ErasureRegion;
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
