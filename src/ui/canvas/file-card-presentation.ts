import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CanvasNode } from '../workspace/workspace-types.ts';

const firstOpenLayer = 4;
const emptyIds: readonly string[] = [];
export const imageDescriptionEditingClass = 'file-node-image-editing';

export const isVisibleCanvasNode = (
  node: Pick<CanvasNode, 'hidden' | 'className'>,
) => !node.hidden && !node.className?.includes('section-member-hidden');

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
export function useFileCardPresentation(nodes: CanvasNode[], scope: string) {
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
  const open = useMemo(
    () =>
      new Set(
        nodes
          .filter((node) => openFileCard(node, images))
          .map((node) => node.id),
      ),
    [nodes, images],
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
    if (!order.length) return nodes;
    const ranks = new Map(
      order.map((id, index) => [id, firstOpenLayer + index]),
    );
    return nodes.map((node) => {
      const layer = node.zIndex ?? 0;
      const zIndex =
        ranks.get(node.id) ??
        (layer >= firstOpenLayer ? layer + order.length : layer);
      const className =
        images.has(node.id) && ranks.has(node.id)
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
  }, [nodes, order, images]);

  return { renderedNodes, activate, reportImageEditing };
}
