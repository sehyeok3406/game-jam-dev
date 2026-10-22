import type { CanvasDocument } from '../../contracts/documents';
import type { CanvasSection } from '../../contracts/canvas';
import type { DrawingObject } from '../../contracts/drawing-types';
import type { CommandEnvironment } from '../../core/editing/environment';

export type DeletionItem = Pick<
  CanvasDocument,
  'id' | 'title' | 'relativePath' | 'revision' | 'asset'
>;
export type SelectionTargets = {
  documents: DeletionItem[];
  sections: CanvasSection[];
  drawings: DrawingObject[];
};
export type ArrangementAction =
  | 'left'
  | 'center-x'
  | 'right'
  | 'top'
  | 'center-y'
  | 'bottom'
  | 'distribute-x'
  | 'distribute-y';
export type ArrangementItem = {
  revision?: number;
  key: string;
  kind: 'document' | 'section';
  relativePath: string;
  x: number;
  y: number;
  width: number;
  height: number;
  storedHeight: number;
};

export function selectionArrangementItems(
  documents: CanvasDocument[],
  sections: CanvasSection[],
): ArrangementItem[] {
  const members = new Set(
    sections.flatMap((section) =>
      section.members.flatMap((member) => [member.id, member.path]),
    ),
  );
  return [
    ...sections.map((section) => ({
      key: `section:${section.id}`,
      revision: section.revision,
      kind: 'section' as const,
      relativePath: section.relativePath,
      x: section.x,
      y: section.y,
      width: section.width,
      height: section.height,
      storedHeight: section.height,
    })),
    ...documents
      .filter(
        (document) =>
          !members.has(document.id) && !members.has(document.relativePath),
      )
      .map((document) => ({
        key: `document:${document.id}`,
        revision: document.revision,
        kind: 'document' as const,
        relativePath: document.relativePath,
        x: document.x,
        y: document.y,
        width: document.width,
        height: document.collapsed ? 38 : document.height,
        storedHeight: document.height,
      })),
  ];
}

/** Uses displayed bounds for alignment but keeps the stored expanded height. */
export function arrangeSelectionItems(
  items: ArrangementItem[],
  action: ArrangementAction,
) {
  if (items.length < 2) return [];
  if (
    (action === 'distribute-x' || action === 'distribute-y') &&
    items.length < 3
  )
    throw Error('동일 간격 배치에는 3개 이상의 항목이 필요합니다.');
  const left = Math.min(...items.map((item) => item.x)),
    right = Math.max(...items.map((item) => item.x + item.width));
  const top = Math.min(...items.map((item) => item.y)),
    bottom = Math.max(...items.map((item) => item.y + item.height));
  const positions = new Map(
    items.map((item) => [item.key, { x: item.x, y: item.y }]),
  );
  if (action === 'distribute-x' || action === 'distribute-y') {
    const axis = action === 'distribute-x' ? 'x' : 'y',
      size = axis === 'x' ? 'width' : 'height';
    const sorted = [...items].sort((a, b) => a[axis] - b[axis]);
    const available =
      sorted.at(-1)![axis] +
      sorted.at(-1)![size] -
      sorted[0][axis] -
      sorted.reduce((sum, item) => sum + item[size], 0);
    const gap = available / (sorted.length - 1);
    let cursor = sorted[0][axis];
    for (const item of sorted) {
      positions.get(item.key)![axis] = cursor;
      cursor += item[size] + gap;
    }
  } else
    for (const item of items) {
      const p = positions.get(item.key)!;
      if (action === 'left') p.x = left;
      if (action === 'center-x') p.x = (left + right - item.width) / 2;
      if (action === 'right') p.x = right - item.width;
      if (action === 'top') p.y = top;
      if (action === 'center-y') p.y = (top + bottom - item.height) / 2;
      if (action === 'bottom') p.y = bottom - item.height;
    }
  return items.map((item) => ({
    kind: item.kind,
    relativePath: item.relativePath,
    revision: item.revision,
    ...positions.get(item.key)!,
    width: item.width,
    height: item.storedHeight,
    ...(item.kind === 'section' ? { moveMembers: true } : {}),
  }));
}

export function copiedSelection(
  documents: CanvasDocument[],
  selectedIds: string[],
  drawings: DrawingObject[],
) {
  return {
    documents: documents
      .filter((doc) => selectedIds.includes(doc.id))
      .map((doc) => ({ id: doc.id, path: doc.relativePath })),
    drawings: structuredClone(drawings),
  };
}

export function copyDrawingObjects(
  objects: DrawingObject[],
  offset: number,
  environment: CommandEnvironment,
) {
  const now = environment.now();
  return objects.map((object) => ({
    ...object,
    id: environment.id(),
    generation: environment.id(),
    createdAt: now,
    updatedAt: now,
    transform: {
      ...object.transform,
      x: object.transform.x + offset,
      y: object.transform.y + offset,
    },
  }));
}
