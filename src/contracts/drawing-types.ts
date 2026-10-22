export type EraserMode = 'stroke' | 'partial';
export type DrawingPolygon = [number, number][][];
export type ErasureRegion = { id: string; polygons: DrawingPolygon[] };
export type DrawingErasure = {
  id: string;
  generation: string;
  expectedTransform: DrawingTransform;
  expectedGeometry: StrokeObject['geometry'];
  expectedStrokeWidth: number;
  region: ErasureRegion;
};
export type DrawingItem = DrawingObject & {
  canvasId: string;
};
export type DrawingObject = ShapeObject | StrokeObject;
export type ShapeObject = DrawingBase & {
  kind: 'shape';
  geometry: {
    shape: ShapeKind;
    cornerRadius?: number;
    endpoints?: [[number, number], [number, number]];
  };
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
export type ShapeKind =
  | 'rectangle'
  | 'rounded-rectangle'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'line'
  | 'arrow';
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
export type DrawingChanges = {
  changed: DrawingItem[];
  removed: string[];
  signatures: Record<string, string>;
};
export type DrawingCommand = {
  scope?: string;
  requestId?: string;
  canvasId: string;
  action: 'create' | 'patch' | 'delete' | 'move' | 'erase';
  objects?: DrawingObject[];
  erasures?: DrawingErasure[];
  patches?: DrawingPatch[];
  targets?: {
    id: string;
    generation: string;
  }[];
  targetCanvasId?: string;
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
export type DrawingDelta = {
  version?: 1 | 2;
  canvasId: string;
  upsert: DrawingObject[];
  removed: string[];
  deleted: boolean;
};
