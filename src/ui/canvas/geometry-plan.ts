import type { CanvasDocument } from '../../contracts/documents';
import type { CanvasSection } from '../../contracts/canvas';

export interface DocumentGeometry {
  parentId?: string;
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
  data: { document: CanvasDocument };
}

/** React Flow stores child coordinates relative to a section; files store absolute coordinates. */
export function documentDragLayout(
  node: DocumentGeometry,
  sections: CanvasSection[],
) {
  const document = node.data.document;
  const parent = sections.find(
    (section) => node.parentId === `section:${section.id}`,
  );
  return {
    kind: 'document' as const,
    objectId: document.id,
    structureRevision: document.structureRevision,
    size: false,
    relativePath: document.relativePath,
    revision: document.revision,
    x: node.position.x + (parent?.x ?? 0),
    y: node.position.y + (parent?.y ?? 0),
    width: node.measured?.width ?? document.width,
    height: document.collapsed
      ? document.height
      : (node.measured?.height ?? document.height),
  };
}

export function documentMembership(
  node: DocumentGeometry,
  sections: CanvasSection[],
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
  const centerX = layout.x + layout.width / 2;
  const centerY = layout.y + (node.measured?.height ?? document.height) / 2;
  const toSection =
    [...sections]
      .filter(
        (section) =>
          centerX >= section.x &&
          centerX <= section.x + section.width &&
          centerY >= section.y &&
          centerY <= section.y + section.height,
      )
      .sort(
        (left, right) => left.width * left.height - right.width * right.height,
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
