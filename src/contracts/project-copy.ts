import type { Snapshot } from './project.ts';
import type { CanvasSheets, SectionMember } from './canvas.ts';
import type { DrawingObject } from './drawing-types.ts';
import type { ProjectSessionRef } from './project-session.ts';

export type ProjectCopySelection = {
  canvasId: string;
  documents: SectionMember[];
  sections: SectionMember[];
  previews: string[];
  previewWindows?: Record<
    string,
    { x: number; y: number; width: number; height: number; collapsed: boolean }
  >;
  drawings: { id: string; generation: string }[];
};
export type ProjectCopyBundle = {
  version: 1;
  files: Snapshot;
  documents: string[];
  sections: string[];
  previews: string[];
  drawings: DrawingObject[];
  statusNames: Record<string, string>;
};
export type ProjectCopyImport = {
  requestId: string;
  canvasId: string;
  bundle: ProjectCopyBundle;
};
export type ProjectCopyResult = {
  count: number;
  paths: string[];
  drawingIds: string[];
  warnings: string[];
};
export type ProjectCopyRequest = {
  session: ProjectSessionRef;
  targetId: string;
  selection: ProjectCopySelection;
} & Pick<ProjectCopyImport, 'requestId' | 'canvasId'>;
export type ProjectCopyTarget = {
  id: string;
  name: string;
  sheets: CanvasSheets;
};
