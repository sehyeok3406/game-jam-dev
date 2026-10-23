import { useEffect, useMemo, useRef, useState } from 'react';
import { drawingBounds } from '../../drawing-geometry.ts';
import type { DrawingCommand, DrawingObject } from '../../drawing-types.ts';
import type {
  CanvasDocument,
  CanvasSection,
  PreviewWindowState,
} from '../../shared.ts';
import { documentDragLayout, documentMembership } from './geometry-plan.ts';
import type { MembershipPrompt } from './section-actions.ts';
import type { SectionCanvasNode } from './SectionCard';
import { selectionScopeKey, type SelectionScope } from './selection-actions.ts';
import type { DocumentCanvasNode } from '../documents/DocumentCard';
import type { DrawingCanvasNode } from '../drawing/DrawingNode';
import type { CanvasNode } from '../workspace/workspace-types.ts';
interface GeometryPorts {
  sections: CanvasSection[];
  api: import('../../contracts/app-api.ts').AppApi;
  loadProject: (fit?: boolean, throwOnError?: boolean) => Promise<void>;
  showError: (error: unknown) => void;
  gameUi: {
    frames: import('../../game-ui-types').GameUiFrame[];
    submit: (c: import('../../game-ui-types').GameUiCommand) => Promise<void>;
    error: string;
    retry: () => void;
    flush: () => Promise<void>;
    saving: boolean;
  };
  blockAiFiles: (paths: string[]) => boolean;
  updatePreviewWindow: (
    relative: string,
    state: PreviewWindowState,
  ) => Promise<void>;
  updatePreviewWindows: (
    windows: { relative: string; state: PreviewWindowState }[],
  ) => Promise<void>;
  locked: boolean;
  sectionCollapsed: (section: CanvasSection) => boolean;
  canvasBatch: (
    commands: { channel: string; input: unknown }[],
  ) => Promise<unknown[]>;
  activeCanvasRef: import('react').RefObject<string>;
  drawing: {
    items: import('../../drawing-types').DrawingItem[];
    submit: (
      command: Omit<DrawingCommand, 'canvasId' | 'scope'> & {
        canvasId?: string;
      },
    ) => Promise<void>;
    flush: () => Promise<void>;
    reload: () => Promise<void>;
    partial: (object: DrawingObject | null) => void;
    error: string;
    recovery: DrawingCommand[] | null;
    recover: () => Promise<void>;
    discardRecovery: () => Promise<void>;
    retry: () => void;
    hold: () => Promise<void>;
    saving: boolean;
  };
  setNotice: import('react').Dispatch<import('react').SetStateAction<string>>;
  setMembershipPrompt: (
    value: import('react').SetStateAction<
      import('./section-actions.ts').MembershipPrompt | null
    >,
  ) => void;
}
type PendingGeometry = Map<
  string,
  {
    sequence: number;
    position: { x: number; y: number };
    style: CanvasNode['style'];
  }
>;
interface GeometryState {
  pendingGeometry: { current: PendingGeometry };
  geometrySequence: { current: number };
  setGeometryEpoch: React.Dispatch<React.SetStateAction<number>>;
}
function createGeometryActions(
  ports: GeometryPorts,
  state: GeometryState,
  isCurrent: () => boolean,
) {
  const {
    sections,
    api,
    loadProject,
    showError,
    gameUi,
    blockAiFiles,
    updatePreviewWindow,
    updatePreviewWindows,
    locked,
    sectionCollapsed,
    canvasBatch,
    activeCanvasRef,
    drawing,
    setNotice,
    setMembershipPrompt,
  } = ports;
  const { pendingGeometry, geometrySequence, setGeometryEpoch } = state;
  const persistResizedNodes = async (nodes: CanvasNode[]) => {
    if (locked || !isCurrent()) return;
    if (
      blockAiFiles(
        nodes.flatMap((node) =>
          node.data.kind === 'document'
            ? [node.data.document.relativePath]
            : node.data.kind === 'preview'
              ? [node.data.preview.relativePath]
              : [],
        ),
      )
    )
      return;
    const sequence = ++geometrySequence.current;
    for (const node of nodes)
      pendingGeometry.current.set(node.id, {
        sequence,
        position: node.position,
        style: node.style,
      });
    setGeometryEpoch((epoch) => epoch + 1);
    try {
      const documents = nodes.filter(
        (node): node is DocumentCanvasNode => node.data.kind === 'document',
      );
      if (documents.length)
        await api.editor.updateLayouts(
          documents.map((node) => ({
            ...documentDragLayout(node, sections),
            size: true,
          })),
        );
      if (!isCurrent()) return;
      await updatePreviewWindows(
        nodes.flatMap((node) =>
          node.data.kind === 'preview'
            ? [
                {
                  relative: node.data.preview.relativePath,
                  state: {
                    ...node.data.windowState,
                    ...node.position,
                    width: node.measured!.width!,
                    height: node.measured!.height!,
                  },
                },
              ]
            : [],
        ),
      );
      if (isCurrent())
        setNotice(`${nodes.length}개 항목의 크기를 함께 저장했습니다.`);
    } catch (error) {
      if (isCurrent()) showError(error);
    } finally {
      if (isCurrent()) await loadProject(false).catch(showError);
      for (const node of nodes)
        if (pendingGeometry.current.get(node.id)?.sequence === sequence)
          pendingGeometry.current.delete(node.id);
      if (isCurrent()) setGeometryEpoch((epoch) => epoch + 1);
    }
  };
  const resizeDocument = async (
    document: CanvasDocument,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => {
    try {
      const parent = sections.find((section) =>
        section.members.some(
          (member) =>
            member.id === document.id || member.path === document.relativePath,
        ),
      );
      const sequence = ++geometrySequence.current;
      pendingGeometry.current.set(document.id, {
        sequence,
        position: { x, y },
        style: { width, height },
      });
      try {
        await api.editor.updateDocumentLayout({
          relativePath: document.relativePath,
          revision: document.revision,
          objectId: document.id,
          structureRevision: document.structureRevision,
          x: x + (parent?.x ?? 0),
          y: y + (parent?.y ?? 0),
          width,
          height,
        });
        if (isCurrent()) await loadProject(false);
      } finally {
        if (pendingGeometry.current.get(document.id)?.sequence === sequence)
          pendingGeometry.current.delete(document.id);
        setGeometryEpoch((epoch) => epoch + 1);
      }
    } catch (error) {
      if (isCurrent()) showError(error);
    }
  };

  const resizeSection = async (
    section: CanvasSection,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => {
    try {
      await api.editor.updateSectionLayout({
        relativePath: section.relativePath,
        revision: section.revision,
        objectId: section.id,
        structureRevision: section.structureRevision,
        x,
        y,
        width,
        height,
        moveMembers: false,
      });
    } catch (error) {
      if (isCurrent()) showError(error);
    }
  };

  const persistDraggedNodes = async (
    primary: CanvasNode,
    dragged: CanvasNode[],
  ) => {
    const moved = dragged.length ? dragged : [primary];
    const sequence = ++geometrySequence.current;
    let membership: MembershipPrompt | null = null;
    for (const node of moved)
      pendingGeometry.current.set(node.id, {
        sequence,
        position: node.position,
        style: node.style,
      });
    requestAnimationFrame(() => {
      if (isCurrent()) setGeometryEpoch((epoch) => epoch + 1);
    });
    try {
      membership = (await performPersistDraggedNodes(primary, dragged)) ?? null;
      if (!isCurrent()) return;
      if (moved.some((node) => node.data.kind !== 'kanban'))
        if (isCurrent()) await loadProject(false);
    } finally {
      for (const node of moved)
        if (pendingGeometry.current.get(node.id)?.sequence === sequence)
          pendingGeometry.current.delete(node.id);
      if (isCurrent()) setGeometryEpoch((epoch) => epoch + 1);
    }
    if (membership && isCurrent() && sequence === geometrySequence.current)
      setMembershipPrompt(membership);
  };
  const performPersistDraggedNodes = async (
    primaryNode: CanvasNode,
    draggedNodes: CanvasNode[],
  ) => {
    const allMovedNodes =
      draggedNodes.length > 0 ? draggedNodes : [primaryNode];
    for (const node of allMovedNodes)
      if (node.data.kind === 'kanban')
        node.data.update({
          ...node.data.preferences,
          x: node.position.x,
          y: node.position.y,
          placed: true,
        });
    for (const node of allMovedNodes)
      if (node.data.kind === 'game-ui') {
        const f = node.data.frame;
        if (!isCurrent()) return;
        await gameUi.submit({
          id: f.id,
          generation: f.generation,
          action: 'frame',
          changes: { x: node.position.x, y: node.position.y },
          expected: { x: f.x, y: f.y },
        });
      }
    if (!isCurrent()) return;
    const movedNodes = allMovedNodes.filter(
      (n) => n.data.kind !== 'kanban' && n.data.kind !== 'game-ui',
    );
    if (!movedNodes.length) return;
    if (
      blockAiFiles(
        movedNodes.flatMap((node) =>
          node.data.kind === 'section'
            ? [
                node.data.section.relativePath,
                ...node.data.section.members.map((member) => member.path),
              ]
            : [
                node.data.kind === 'document'
                  ? node.data.document.relativePath
                  : node.data.kind === 'preview'
                    ? node.data.preview.relativePath
                    : '',
              ],
        ),
      )
    ) {
      return;
    }
    for (const moved of movedNodes) {
      if (moved.data.kind === 'preview') {
        await updatePreviewWindow(moved.data.preview.relativePath, {
          ...moved.data.windowState,
          x: moved.position.x,
          y: moved.position.y,
          width: moved.measured?.width ?? moved.data.windowState.width,
          height: moved.data.windowState.collapsed
            ? moved.data.windowState.height
            : (moved.measured?.height ?? moved.data.windowState.height),
        });
      }
    }
    if (!movedNodes.some((node) => node.data.kind !== 'preview')) return;
    if (locked || !isCurrent()) return;

    if (
      movedNodes.length > 1 ||
      movedNodes.some((n) => n.data.kind === 'drawing')
    ) {
      const movedSectionNodeIds = new Set(
        movedNodes.flatMap((node) =>
          node.data.kind === 'section' ? [node.id] : [],
        ),
      );
      const movedSections = movedNodes.filter(
        (node): node is SectionCanvasNode => node.data.kind === 'section',
      );
      const movedDocuments = movedNodes.filter(
        (node): node is DocumentCanvasNode =>
          node.data.kind === 'document' &&
          (!node.parentId || !movedSectionNodeIds.has(node.parentId)),
      );

      try {
        const updates: Parameters<typeof api.editor.updateLayouts>[0] = [];
        for (const sectionNode of movedSections) {
          const section = sectionNode.data.section;
          updates.push({
            kind: 'section',
            objectId: section.id,
            structureRevision: section.structureRevision,
            relativePath: section.relativePath,
            revision: section.revision,
            x: sectionNode.position.x,
            y: sectionNode.position.y,
            width: sectionNode.measured?.width ?? section.width,
            height: sectionCollapsed(section)
              ? section.height
              : (sectionNode.measured?.height ?? section.height),
            moveMembers: true,
          });
        }

        updates.push(
          ...movedDocuments.map((node) => documentDragLayout(node, sections)),
        );
        const drawingNodes = movedNodes.filter(
          (n): n is DrawingCanvasNode => n.data.kind === 'drawing',
        );
        if (drawingNodes.length) {
          const patches = drawingNodes.map((n) => {
            const b = drawingBounds(n.data.object);
            return {
              id: n.data.object.id,
              generation: n.data.object.generation,
              transform: {
                x: n.data.object.transform.x + n.position.x - b.x,
                y: n.data.object.transform.y + n.position.y - b.y,
              },
            };
          });
          if (updates.length)
            await canvasBatch([
              { channel: 'layouts:update', input: { updates } },
              {
                channel: 'drawings:apply',
                input: {
                  canvasId: activeCanvasRef.current,
                  action: 'patch',
                  patches,
                },
              },
            ]);
          else await drawing.submit({ action: 'patch', patches });
        } else await api.editor.updateLayouts(updates);

        if (isCurrent())
          setNotice(`${movedNodes.length}개 항목의 위치를 함께 저장했습니다.`);
      } catch (error) {
        if (isCurrent()) showError(error);
      }
      return;
    }

    const node = movedNodes[0];
    if (node.data.kind === 'section') {
      const section = node.data.section;
      try {
        await api.editor.updateSectionLayout({
          relativePath: section.relativePath,
          revision: section.revision,
          objectId: section.id,
          structureRevision: section.structureRevision,
          x: node.position.x,
          y: node.position.y,
          width: node.measured?.width ?? section.width,
          height: node.measured?.height ?? section.height,
          moveMembers: true,
        });
      } catch (error) {
        if (isCurrent()) showError(error);
      }
      return;
    }
    if (node.data.kind !== 'document') return;

    const membership = documentMembership(node as DocumentCanvasNode, sections);
    if (membership) return membership;
    const { kind: _kind, ...layout } = documentDragLayout(
      node as DocumentCanvasNode,
      sections,
    );
    try {
      await api.editor.updateDocumentLayout(layout);
    } catch (error) {
      if (isCurrent()) showError(error);
    }
  };

  return {
    resizeDocument,
    resizeSection,
    persistDraggedNodes,
    persistResizedNodes,
  };
}
export function useCanvasGeometry(
  scope: SelectionScope,
  ports: () => GeometryPorts,
) {
  const key = selectionScopeKey(scope);
  const current = useRef(ports);
  current.current = ports;
  const active = useRef(key);
  active.current = key;
  const mounted = useRef(true);
  const pendingGeometry = useRef(
    new Map<
      string,
      {
        sequence: number;
        position: { x: number; y: number };
        style: CanvasNode['style'];
      }
    >(),
  );
  const geometrySequence = useRef(0);
  const [geometryEpoch, setGeometryEpoch] = useState(0);

  const pendingScope = useRef(key);
  if (pendingScope.current !== key) {
    pendingScope.current = key;
    pendingGeometry.current = new Map();
    geometrySequence.current++;
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const actions = useMemo(() => {
    const isCurrent = () => mounted.current && active.current === key;
    const state = {
      pendingGeometry: { current: pendingGeometry.current },
      geometrySequence,
      setGeometryEpoch,
    };
    return {
      persistResizedNodes: (nodes: CanvasNode[]) => {
        if (!isCurrent()) return Promise.resolve();
        return createGeometryActions(
          current.current(),
          state,
          isCurrent,
        ).persistResizedNodes(nodes);
      },
      resizeDocument: (
        ...args: Parameters<
          ReturnType<typeof createGeometryActions>['resizeDocument']
        >
      ) => {
        if (!isCurrent()) return Promise.resolve();
        return createGeometryActions(
          current.current(),
          state,
          isCurrent,
        ).resizeDocument(...args);
      },
      resizeSection: (
        ...args: Parameters<
          ReturnType<typeof createGeometryActions>['resizeSection']
        >
      ) => {
        if (!isCurrent()) return Promise.resolve();
        return createGeometryActions(
          current.current(),
          state,
          isCurrent,
        ).resizeSection(...args);
      },
      persistDraggedNodes: (
        ...args: Parameters<
          ReturnType<typeof createGeometryActions>['persistDraggedNodes']
        >
      ) => {
        if (!isCurrent()) return Promise.resolve();
        return createGeometryActions(
          current.current(),
          state,
          isCurrent,
        ).persistDraggedNodes(...args);
      },
    };
  }, [key]);
  return { ...actions, pendingGeometry, geometryEpoch };
}
