export type CanvasSheet = {
  id: string;
  name: string;
};
export type CanvasSheets = {
  version: 1;
  canvases: CanvasSheet[];
  raw?: string | null;
};
export type CanvasSheetCommand = {
  action: 'add' | 'rename' | 'reorder' | 'move' | 'delete';
  expected: string | null;
  id: string;
  name?: string;
  order?: string[];
  targetId?: string;
  paths?: string[];
};
export type SectionMember = {
  id: string;
  path: string;
};
export type CanvasSection = {
  parentSectionId?: string;
  structureRevision?: number;
  canvasId?: string;
  revision?: number;
  id: string;
  title: string;
  relativePath: string;
  x: number;
  y: number;
  width: number;
  height: number;
  members: SectionMember[];
  modifiedAt: number;
};
export type LayoutUpdate = {
  structureRevision?: number;
  objectId?: string;
  position?: boolean;
  size?: boolean;
  revision?: number;
  relativePath: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type DeleteSectionInput = {
  revision?: number;
  sectionId: string;
  relativePath: string;
  deleteMembers: boolean;
  expectedPaths?: string[];
};
export type DeleteSectionResult = {
  deletedDocumentCount: number;
  preservedDocumentCount: number;
};
export type CreateSectionInput = {
  parentSectionId?: string;
  canvasId?: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  members: SectionMember[];
};
export type SectionLayoutUpdate = {
  structureRevision?: number;
  objectId?: string;
  revision?: number;
  relativePath: string;
  x: number;
  y: number;
  width: number;
  height: number;
  moveMembers?: boolean;
  membership?: {
    expectedParentId: string | null;
    targetParentId: string | null;
  };
};
export type MoveDocumentSectionInput = {
  revision?: number;
  documentId: string;
  documentPath: string;
  targetSectionId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
};
