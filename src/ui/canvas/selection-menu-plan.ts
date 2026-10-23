import type { CanvasNode } from '../workspace/workspace-types.ts';
import type { CollapseTarget } from './collapse-actions.ts';
import type { ProjectCopySelection } from '../../contracts/project-copy.ts';

export function contextSelection(nodes: CanvasNode[], hit?: CanvasNode) {
  return hit
    ? nodes.some((node) => node.id === hit.id && node.selected)
      ? nodes.filter((node) => node.selected)
      : [hit]
    : nodes.filter((node) => node.selected);
}
export function selectionMenuTargets(nodes: CanvasNode[]) {
  const documents = nodes.flatMap((node) =>
    node.data.kind === 'document' ? [node.data.document] : [],
  );
  const sections = nodes.flatMap((node) =>
    node.data.kind === 'section' ? [node.data.section] : [],
  );
  const previews = nodes.flatMap((node) =>
    node.data.kind === 'preview' ? [node.data.preview] : [],
  );
  const drawings = nodes.flatMap((node) =>
    node.data.kind === 'drawing' ? [node.data.object] : [],
  );
  const collapse = nodes.flatMap((node): CollapseTarget[] => {
    if (node.data.kind === 'document')
      return [{ kind: 'document', document: node.data.document }];
    if (node.data.kind === 'section')
      return [
        {
          kind: 'section',
          section: node.data.section,
          collapsed: node.data.collapsed,
        },
      ];
    if (node.data.kind === 'preview')
      return [
        {
          kind: 'preview',
          relativePath: node.data.preview.relativePath,
          windowState: node.data.windowState,
        },
      ];
    return [];
  });
  return {
    documents: structuredClone(documents),
    sections: structuredClone(sections),
    previews: structuredClone(previews),
    drawings: structuredClone(drawings),
    collapse,
    count: nodes.length,
  };
}
export type SelectionMenuTargets = ReturnType<typeof selectionMenuTargets>;
export function projectCopySelection(
  targets: SelectionMenuTargets,
  canvasId: string,
): ProjectCopySelection {
  return {
    canvasId,
    documents: targets.documents.map((doc) => ({
      id: doc.id,
      path: doc.relativePath,
    })),
    sections: targets.sections.map((section) => ({
      id: section.id,
      path: section.relativePath,
    })),
    previews: targets.previews.map((preview) => preview.relativePath),
    previewWindows: Object.fromEntries(
      targets.collapse.flatMap((item) =>
        item.kind === 'preview'
          ? [
              [
                item.relativePath,
                {
                  x: item.windowState.x,
                  y: item.windowState.y,
                  width: item.windowState.width,
                  height: item.windowState.height,
                  collapsed: item.windowState.collapsed,
                },
              ],
            ]
          : [],
      ),
    ),
    drawings: targets.drawings.map((object) => ({
      id: object.id,
      generation: object.generation,
    })),
  };
}
export function selectionMenuPaths(targets: SelectionMenuTargets) {
  const members = new Set(
    targets.sections.flatMap((section) =>
      section.members.map((member) => member.path),
    ),
  );
  return [
    ...targets.sections.map((section) => section.relativePath),
    ...targets.documents
      .filter((doc) => !members.has(doc.relativePath))
      .map((doc) => doc.relativePath),
    ...targets.previews.map((preview) => preview.relativePath),
  ];
}
