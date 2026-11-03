import { useEffect, useRef, useState } from 'react';
import type { ReactFlowInstance } from '@xyflow/react';
import { useNodesInitialized } from '@xyflow/react';
import type { LocationOpenResult } from '../../contracts/location-links.ts';
import type { ProjectSessionRef } from '../../contracts/project-session.ts';
import { locationViewport } from '../../core/projects/location-links.ts';
import type { CanvasNode } from '../workspace/workspace-types.ts';
import { previewNodeId } from '../workspace/workspace-types.ts';

type Ports = {
  session?: ProjectSessionRef;
  activeCanvas: string;
  nodes: CanvasNode[];
  flow: ReactFlowInstance<CanvasNode> | null;
  switchCanvas(id: string): Promise<void>;
  revealDocument(id: string): void;
  select(id: string): void;
  report(message: string): void;
  beforeNavigate(): void;
};

/** A cancellable camera move also works when another React Flow transition was interrupted. */
function moveViewport(
  flow: ReactFlowInstance<CanvasNode>,
  target: { x: number; y: number; zoom: number },
  current: () => boolean,
) {
  const start = flow.getViewport(),
    started = performance.now();
  return new Promise<boolean>((resolve) => {
    const frame = () => {
      if (!current()) {
        resolve(false);
        return;
      }
      const t = Math.min(1, (performance.now() - started) / 300),
        ease = t * t * (3 - 2 * t);
      void flow.setViewport(
        {
          x: start.x + (target.x - start.x) * ease,
          y: start.y + (target.y - start.y) * ease,
          zoom: start.zoom + (target.zoom - start.zoom) * ease,
        },
        { duration: 0 },
      );
      if (t < 1) requestAnimationFrame(frame);
      else resolve(true);
    };
    requestAnimationFrame(frame);
  });
}
export function useLocationNavigation(ports: () => Ports) {
  const latest = useRef(ports);
  latest.current = ports;
  const [pending, setPending] = useState<LocationOpenResult | null>(null);
  const [highlight, setHighlight] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const switching = useRef<LocationOpenResult | null>(null);
  const generation = useRef(0);
  const p = ports();
  const initialized = useNodesInitialized();
  useEffect(() => {
    if (!pending) return;
    if (pending.workspace.session?.sessionId !== p.session?.sessionId) {
      setPending(null);
      return;
    }
    const item = pending.item;
    if (p.activeCanvas !== item.canvasId) {
      if (switching.current === pending) return;
      switching.current = pending;
      void p.switchCanvas(item.canvasId).catch((error) => {
        if (switching.current === pending) {
          setPending(null);
          latest.current().report(String(error.message ?? error));
        }
      });
      return;
    }
    const id =
      item.documentId ??
      (item.target.kind === 'drawing'
        ? `drawing:${item.target.id}`
        : previewNodeId(item.previewIdentityPath ?? item.relativePath!));
    const node = p.nodes.find((node) => node.id === id);
    if (!node || !p.flow) return;
    if (node.className?.includes('section-member-hidden')) {
      p.select(id);
      return;
    }
    if (node.data.kind === 'document' && node.data.document.collapsed) {
      p.revealDocument(node.data.document.id);
      return;
    }
    const element = [
      ...document.querySelectorAll<HTMLElement>('.react-flow__node'),
    ].find((el) => el.dataset.id === id);
    const pane = element?.closest<HTMLElement>('.react-flow');
    if (!element || !pane) return;
    const internal = p.flow.getInternalNode(id),
      measured = internal?.measured;
    if (!measured?.width || !measured.height) return;
    const readable =
      node.data.kind === 'preview' ||
      (node.data.kind === 'document' && node.data.document.type !== 'image') ||
      (node.data.kind === 'drawing' && node.data.object.kind === 'text');
    const viewport = locationViewport(
      {
        ...(internal?.internals.positionAbsolute ?? node.position),
        width: measured.width,
        height: measured.height,
      },
      pane.clientWidth,
      pane.clientHeight,
      readable,
    );
    p.beforeNavigate();
    p.select(id);
    setPending(null);
    const ticket = ++generation.current;
    let highlighted: HTMLElement = element;
    void moveViewport(
      p.flow,
      viewport,
      () => ticket === generation.current && element.isConnected,
    ).then(async () => {
      if (
        ticket !== generation.current ||
        !element.isConnected ||
        !item.target.blockId
      )
        return;
      const matches = [
        ...element.querySelectorAll<HTMLElement>('[data-location-block]'),
      ].filter((el) => el.dataset.locationBlock === item.target.blockId);
      if (item.blockMissing || matches.length !== 1) {
        latest
          .current()
          .report(
            '문서는 열었지만 해당 문단이 삭제되었거나 위치 표시를 찾을 수 없습니다.',
          );
        return;
      }
      const block =
        matches[0].closest<HTMLElement>('p,h1,h2,h3,h4,h5,h6,td,li') ??
        matches[0];
      const scroll = block.closest<HTMLElement>(
        '.document-card__content, .document-editor',
      );
      if (scroll) {
        const rect = block.getBoundingClientRect(),
          parent = scroll.getBoundingClientRect();
        scroll.scrollTop +=
          (rect.top - parent.top + rect.height / 2) / viewport.zoom -
          scroll.clientHeight / 2;
      } else {
        const rect = block.getBoundingClientRect(),
          position = p.flow!.screenToFlowPosition({
            x: rect.left,
            y: rect.top,
          });
        await moveViewport(
          p.flow!,
          locationViewport(
            {
              ...position,
              width: rect.width / viewport.zoom,
              height: rect.height / viewport.zoom,
            },
            pane.clientWidth,
            pane.clientHeight,
            true,
          ),
          () => ticket === generation.current && element.isConnected,
        );
      }
      if (ticket === generation.current) highlighted = block;
    });
    const started = performance.now();
    const paint = () => {
      if (ticket !== generation.current || !element.isConnected) return;
      const rect = highlighted.getBoundingClientRect();
      const width = Math.max(32, rect.width + 12),
        height = Math.max(
          32,
          Math.min(rect.height + 12, pane.clientHeight - 16),
        );
      setHighlight({
        x: rect.left + rect.width / 2 - width / 2,
        y: readable
          ? Math.max(pane.getBoundingClientRect().top + 8, rect.top - 6)
          : rect.top + rect.height / 2 - height / 2,
        width,
        height,
      });
      if (performance.now() - started < 1800) requestAnimationFrame(paint);
      else setHighlight(null);
    };
    requestAnimationFrame(paint);
    if (readable) {
      element
        .querySelectorAll<HTMLElement>(
          '.document-card__content, .document-editor',
        )
        .forEach((el) => {
          el.scrollTop = 0;
        });
    }
  }, [pending, p.activeCanvas, p.nodes, p.session?.sessionId, initialized]);
  useEffect(() => {
    const cancel = () => {
      generation.current++;
      setPending(null);
      setHighlight(null);
    };
    window.addEventListener('pointerdown', cancel, true);
    window.addEventListener('wheel', cancel, true);
    return () => {
      generation.current++;
      window.removeEventListener('pointerdown', cancel, true);
      window.removeEventListener('wheel', cancel, true);
    };
  }, []);
  useEffect(() => {
    generation.current++;
    setHighlight(null);
  }, [p.session?.sessionId]);
  return { navigate: setPending, highlight };
}
