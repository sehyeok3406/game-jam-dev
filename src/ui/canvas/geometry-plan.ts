import {
  sectionAncestors,
  sectionTree,
} from '../../core/editing/section-tree.ts';
import type { CanvasDocument } from '../../contracts/documents';
import type { CanvasSection } from '../../contracts/canvas';
import { storedImageLayout } from '../../core/canvas/image-layout.ts';
import { imageDescriptionEditingClass } from './file-card-presentation.ts';

export interface DocumentGeometry {
  parentId?: string;
  className?: string;
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
  data: { document: CanvasDocument; fileNode?: unknown; imageAspect?: number };
}

/** React Flow stores child coordinates relative to a section; files store absolute coordinates. */
export function documentDragLayout(
  node: DocumentGeometry,
  sections: CanvasSection[],
  resize = false,
) {
  const document = node.data.document;
  const imageEditing = node.className?.includes(imageDescriptionEditingClass);
  const parent = sections.find(
    (section) => node.parentId === `section:${section.id}`,
  );
  const position = {
    x: node.position.x + (parent?.x ?? 0),
    y: node.position.y + (parent?.y ?? 0),
  };
  const size = {
    width:
      imageEditing || (document.collapsed && node.data.fileNode)
        ? document.width
        : (node.measured?.width ?? document.width),
    height:
      imageEditing || document.collapsed
        ? document.height
        : (node.measured?.height ?? document.height),
  };
  return {
    kind: 'document' as const,
    objectId: document.id,
    structureRevision: document.structureRevision,
    size: resize,
    relativePath: document.relativePath,
    revision: document.revision,
    ...(node.data.imageAspect
      ? storedImageLayout(
          document,
          node.data.imageAspect,
          position,
          resize ? size.width : undefined,
        )
      : { ...position, ...size }),
  };
}

export function documentMembership(
  node: DocumentGeometry,
  sections: CanvasSection[],
  canDrop: (section: CanvasSection) => boolean = () => true,
) {
  const document = node.data.document,
    layout = documentDragLayout(node, sections);
  const fromSection =
    sections.find((section) =>
      section.members.some(
        (member) =>
          member.id === document.id || member.path === document.relativePath,
      ),
    ) ?? null;
  const useStoredSize =
    !!node.data.imageAspect ||
    node.className?.includes(imageDescriptionEditingClass);
  const centerX =
    layout.x +
    (useStoredSize ? layout.width : (node.measured?.width ?? document.width)) /
      2;
  const centerY =
    layout.y +
    (useStoredSize
      ? layout.height
      : (node.measured?.height ?? document.height)) /
      2;
  const tree = sectionTree(sections);
  const toSection =
    [...sections]
      .filter(
        (section) =>
          canDrop(section) &&
          centerX >= section.x &&
          centerX <= section.x + section.width &&
          centerY >= section.y &&
          centerY <= section.y + section.height,
      )
      .sort(
        (left, right) =>
          sectionAncestors(tree, right.id).length -
            sectionAncestors(tree, left.id).length ||
          left.width * left.height - right.width * right.height,
      )[0] ?? null;
  if (fromSection?.id === toSection?.id) return null;
  return {
    document,
    fromSection,
    toSection,
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
  };
}
