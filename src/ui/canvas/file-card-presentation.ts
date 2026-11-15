import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CanvasNode } from '../workspace/workspace-types.ts';

const firstOpenLayer = 4;
const emptyIds: readonly string[] = [];
export const imageDescriptionEditingClass = 'file-node-image-editing';

export const isVisibleCanvasNode = (
  node: Pick<CanvasNode, 'hidden' | 'className'>,
) => !node.hidden && !node.className?.includes('section-member-hidden');

export const documentStackKey = (id: string) => 'document:' + id;
export const htmlStackKey = (
  preview: Pick<
    Extract<CanvasNode['data'], { kind: 'preview' }>['preview'],
    'sourceId' | 'identityPath' | 'relativePath'
  >,
) =>
  'html:' + (preview.sourceId ?? preview.identityPath ?? preview.relativePath);

export function canvasStackKey({ data }: CanvasNode): string | undefined {
  switch (data.kind) {
    case 'document':
      return documentStackKey(data.document.id);
    case 'preview':
      return htmlStackKey(data.preview);
    case 'drawing':
      return 'drawing:' + data.object.id;
    case 'game-ui':
      return 'game-ui:' + data.frame.id;
  }
}

function openFileCard(node: CanvasNode, imageEditors: ReadonlySet<string>) {
  if (!isVisibleCanvasNode(node)) return false;
  const data = node.data;
  if (data.kind === 'preview') return !data.windowState.collapsed;
  if (data.kind !== 'document') return false;
  if (data.document.asset) return imageEditors.has(node.id);
  return !!data.fileNode && !data.document.collapsed;
}

const sameOrder = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);
const orderOpenCards = (
  previous: readonly string[],
  open: ReadonlySet<string>,
) => [...new Set([...previous.filter((id) => open.has(id)), ...open])];

/** Presentation only. The logical nodes retain their original layers and dimensions. */
export function useFileCardPresentation(
  nodes: CanvasNode[],
  scope: string,
  stacking: readonly string[] = emptyIds,
) {
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const projections = useRef(new WeakMap<CanvasNode, CanvasNode>());
  const [state, setState] = useState<{
    scope: string;
    order: readonly string[];
    images: readonly string[];
  }>({
    scope,
    order: emptyIds,
    images: emptyIds,
  });
  const previousOrder = state.scope === scope ? state.order : emptyIds;
  const imageIds = state.scope === scope ? state.images : emptyIds;
  const images = useMemo(() => new Set(imageIds), [imageIds]);
  const manualRanks = useMemo(
    () => new Map(stacking.map((key, index) => [key, index])),
    [stacking],
  );
  const open = useMemo(
    () =>
      new Set(
        nodes
          .filter(
            (node) =>
              openFileCard(node, images) &&
              (!manualRanks.size ||
                !manualRanks.has(canvasStackKey(node) ?? '')),
          )
          .map((node) => node.id),
      ),
    [nodes, images, manualRanks],
  );
  const order = useMemo(
    () => orderOpenCards(previousOrder, open),
    [previousOrder, open],
  );

  useLayoutEffect(() => {
    if (state.scope === scope && sameOrder(previousOrder, order)) return;
    setState((previous) =>
      previous.scope === scope
        ? { ...previous, order: orderOpenCards(previous.order, open) }
        : { scope, order, images: emptyIds },
    );
  }, [scope, state.scope, previousOrder, order, open]);

  const reportImageEditing = useCallback(
    (id: string, editing: boolean) => {
      if (activeScope.current !== scope) return;
      setState((previous) => {
        const current =
          previous.scope === scope
            ? previous
            : { scope, order: emptyIds, images: emptyIds };
        if (current.images.includes(id) === editing) return previous;
        return {
          ...current,
          images: editing
            ? [...current.images, id]
            : current.images.filter((item) => item !== id),
        };
      });
    },
    [scope],
  );

  const activate = (id: string) => {
    if (!open.has(id) || order.at(-1) === id) return;
    setState((previous) =>
      previous.scope !== scope
        ? previous
        : {
            ...previous,
            order: [...order.filter((item) => item !== id), id],
          },
    );
  };

  const renderedNodes = useMemo(() => {
    if (!order.length && !stacking.length) return nodes;
    const ranks = new Map(
      order.map((id, index) => [id, firstOpenLayer + index]),
    );
    // React Flow keeps children above their section, including nested sections.
    const stackBase = stacking.length
      ? 2 + nodes.filter((node) => node.data.kind === 'section').length
      : 0;
    return nodes.map((node) => {
      const layer = node.zIndex ?? 0;
      const automatic =
        ranks.get(node.id) ??
        (layer >= firstOpenLayer ? layer + order.length : layer);
      const key = stacking.length ? canvasStackKey(node) : undefined;
      const manual = key === undefined ? undefined : manualRanks.get(key);
      const zIndex =
        key === undefined
          ? automatic
          : stackBase + (manual ?? stacking.length + automatic);
      const className =
        images.has(node.id) && isVisibleCanvasNode(node)
          ? `${node.className ?? ''} ${imageDescriptionEditingClass}`
          : node.className;
      if (zIndex === layer && className === node.className) return node;
      const cached = projections.current.get(node);
      if (cached?.zIndex === zIndex && cached.className === className)
        return cached;
      const projected = { ...node, zIndex, className };
      projections.current.set(node, projected);
      return projected;
    });
  }, [nodes, order, images, stacking, manualRanks]);

  return { renderedNodes, activate, reportImageEditing };
}
