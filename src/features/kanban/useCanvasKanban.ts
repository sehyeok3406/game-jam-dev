import type { ReactFlowInstance } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import { mainDocumentCluster, rectDistance } from '../../canvas-placement';
import { canvasId } from '../../canvas-sheets';
import type { KanbanDocument } from './KanbanBoardContent';
import {
  blankBoardPosition,
  boardVisible,
  defaultCanvasKanban,
  emptyKanbanLayouts,
  kanbanVisibility,
  migrateKanbanLayout,
  readCanvasKanban,
  usePersonalValue,
  type KanbanCanvasPreferences,
  type KanbanLayouts,
} from './preferences';
import { kanbanOrder, type KanbanView } from './view';
import type { PluginPanelPage } from '../plugins/builtin-features';
import { previewLabel } from '../../preview-output';
import type {
  CanvasDocument,
  CanvasSection,
  CanvasSheets,
  PreviewResult,
  PreviewWindowState,
  WorkspaceState,
} from '../../shared';
import { TYPE_LABELS } from '../../ui/documents/presentation';
import type { CanvasTool } from '../../ui/workspace/workspace-types';
import {
  previewNodeId,
  type CanvasNode,
} from '../../ui/workspace/workspace-types';
interface Ports {
  personalScope: string;
  activeCanvas: string;
  setPluginPanelPage: import('react').Dispatch<
    import('react').SetStateAction<PluginPanelPage>
  >;
  setPluginPanelOpen: (value: import('react').SetStateAction<boolean>) => void;
  home: boolean;
  loading: boolean;
  workspace: WorkspaceState;
  flowRef: import('react').RefObject<ReactFlowInstance<CanvasNode> | null>;
  loadedProjectRoot: string | null;
  preferences: import('../../ui/runtime/preferences').PreferenceStore;
  setTool: import('react').Dispatch<import('react').SetStateAction<CanvasTool>>;
  documents: CanvasDocument[];
  previews: PreviewResult[];
  previewWindows: Record<string, PreviewWindowState>;
  nodes: CanvasNode[];
  canvasSheets: CanvasSheets;
  sections: CanvasSection[];
  kanbanView: { value: KanbanView; raw: string | null };
  pathLocked: (path: string) => boolean;
}
export function useCanvasKanban({
  personalScope,
  activeCanvas,
  setPluginPanelPage,
  setPluginPanelOpen,
  home,
  loading,
  workspace,
  flowRef,
  loadedProjectRoot,
  preferences,
  setTool,
  documents,
  previews,
  previewWindows,
  nodes,
  canvasSheets,
  sections,
  kanbanView,
  pathLocked,
}: Ports) {
  const [kanbanLayouts, updateKanbanLayouts] = usePersonalValue<KanbanLayouts>(
    `builtin.kanban.canvas:${personalScope}`,
    emptyKanbanLayouts,
  );
  const kanbanLayoutsRef = useRef(kanbanLayouts);
  kanbanLayoutsRef.current = kanbanLayouts;
  const kanbanVisibilityValue = kanbanVisibility(kanbanLayouts);
  const kanbanPreferences = {
    ...readCanvasKanban(
      kanbanLayouts.canvases?.[activeCanvas] ?? defaultCanvasKanban,
    ),
    enabled: boardVisible(kanbanLayouts, activeCanvas),
  };
  const updateKanbanVisibility = (
    visibility: NonNullable<KanbanLayouts['visibility']>,
  ) => {
    const next = { ...kanbanLayoutsRef.current, visibility };
    kanbanLayoutsRef.current = next;
    updateKanbanLayouts(next);
  };

  const updateKanbanPreferences = (
    value: KanbanCanvasPreferences,
    canvas = activeCanvas,
  ) => {
    const current = kanbanLayoutsRef.current;
    const next = {
      ...current,
      version: 2 as const,
      canvases: { ...current.canvases, [canvas]: readCanvasKanban(value) },
    };
    kanbanLayoutsRef.current = next;
    updateKanbanLayouts(next);
  };

  const focusKanban = useRef(false);
  const lastBoardVisibility = useRef({ scope: '', canvas: '', visible: false });

  const openKanbanControls = () => {
    setPluginPanelPage('builtin.kanban');
    setPluginPanelOpen(true);
  };

  useEffect(() => {
    if (
      home ||
      loading ||
      !workspace.root ||
      !flowRef.current ||
      kanbanLayoutsRef.current.legacyMigrated ||
      loadedProjectRoot !== workspace.root
    )
      return;
    const current = kanbanLayoutsRef.current;
    let raw: string | null = null;
    try {
      raw = preferences.getItem(`builtin.kanban:${personalScope}`);
    } catch {
      /* Personal storage may be unavailable. */
    }
    const migrated = migrateKanbanLayout(
      raw,
      (point) => flowRef.current!.screenToFlowPosition(point),
      flowRef.current.getZoom(),
    );
    const next = {
      ...current,
      version: 2 as const,
      legacyMigrated: true,
      canvases: {
        ...current.canvases,
        ...(migrated && !current.canvases[activeCanvas]
          ? { [activeCanvas]: migrated }
          : {}),
      },
    };
    kanbanLayoutsRef.current = next;
    updateKanbanLayouts(next);
  }, [
    home,
    loading,
    personalScope,
    activeCanvas,
    workspace.root,
    loadedProjectRoot,
  ]);
  const revealKanban = () => {
    updateKanbanPreferences({ ...kanbanPreferences, minimized: false });
    focusKanban.current = true;
    setTool('select');
  };
  const boardPosition = (p: KanbanCanvasPreferences) => {
    const bounds = [
      ...documents
        .filter(
          (d) => canvasId(d.canvasId) === activeCanvas && d.type !== 'ai-task',
        )
        .map((d) => ({ ...d, height: d.collapsed ? 38 : d.height })),
      ...previews
        .filter((d) => canvasId(d.canvasId) === activeCanvas)
        .map((d) => {
          const w = previewWindows[d.relativePath] ??
            d.initialWindow ?? { x: 120, y: 120, width: 720, height: 520 };
          return {
            ...w,
            height: 'collapsed' in w && w.collapsed ? 38 : w.height,
          };
        }),
    ];
    const origin = flowRef.current?.screenToFlowPosition({
      x: window.innerWidth / 2 - p.width / 2,
      y: window.innerHeight / 2 - p.height / 2,
    }) ?? { x: 120, y: 120 };
    const cluster = mainDocumentCluster(bounds, origin);
    const distant =
      p.placed &&
      cluster.length > 0 &&
      Math.min(...cluster.map((b) => rectDistance(p, b))) > 1000;
    return !p.placed || distant
      ? {
          ...p,
          ...blankBoardPosition(origin, bounds, p.width, p.height),
          placed: true,
        }
      : p;
  };
  const toggleKanban = (enabled: boolean) => {
    const value = kanbanVisibility(kanbanLayoutsRef.current);
    updateKanbanVisibility({
      ...value,
      enabled,
      canvasIds:
        value.mode === 'all' || value.canvasIds.length
          ? value.canvasIds
          : [activeCanvas],
    });
    if (enabled && boardVisible(kanbanLayoutsRef.current, activeCanvas)) {
      updateKanbanPreferences(
        boardPosition({ ...kanbanPreferences, enabled: true }),
      );
      focusKanban.current = true;
      setTool('select');
    }
  };
  useEffect(() => {
    if (home || loading || loadedProjectRoot !== workspace.root) return;
    const old = lastBoardVisibility.current;
    lastBoardVisibility.current = {
      scope: personalScope,
      canvas: activeCanvas,
      visible: kanbanPreferences.enabled,
    };
    if (!kanbanPreferences.enabled) return;
    if (
      !kanbanPreferences.placed ||
      old.scope !== personalScope ||
      old.canvas !== activeCanvas ||
      !old.visible
    ) {
      const next = boardPosition(kanbanPreferences);
      if (next !== kanbanPreferences) updateKanbanPreferences(next);
    }
  }, [
    home,
    loading,
    loadedProjectRoot,
    workspace.root,
    activeCanvas,
    personalScope,
    kanbanLayouts,
  ]);
  useEffect(() => {
    if (!focusKanban.current) return;
    const node = nodes.find((n) => n.data.kind === 'kanban');
    if (!node) return;
    focusKanban.current = false;
    const documents = nodes.filter(
      (n) =>
        (n.data.kind === 'document' || n.data.kind === 'preview') &&
        !n.className?.includes('section-member-hidden'),
    );
    const boxes = documents.map((n) => {
      const parent = nodes.find((p) => p.id === n.parentId);
      return {
        x: n.position.x + (parent?.position.x ?? 0),
        y: n.position.y + (parent?.position.y ?? 0),
        width: Number(n.style?.width ?? 340),
        height: Number(n.style?.height ?? 300),
      };
    });
    const group = mainDocumentCluster(boxes, node.position);
    void flowRef.current?.fitView({
      nodes: [
        { id: node.id },
        ...documents
          .filter((_n, i) => group.includes(boxes[i]))
          .map((n) => ({ id: n.id })),
      ],
      padding: 0.24,
      maxZoom: 1,
      duration: 200,
    });
  }, [nodes]);
  const kanbanDocuments: KanbanDocument[] = [
    ...documents
      .filter((d) => d.type !== 'ai-task')
      .map((d) => ({
        id: d.id,
        title: d.title,
        kind: TYPE_LABELS[d.type],
        canvasId: d.canvasId,
        canvasName:
          canvasSheets.canvases.find((c) => c.id === canvasId(d.canvasId))
            ?.name ?? '',
        sectionName: sections.find((s) => s.members.some((m) => m.id === d.id))
          ?.title,
        statusPropertyEnabled: d.statusPropertyEnabled,
        workflowStatusId: d.workflowStatusId,
        workflowOrder: kanbanOrder(kanbanView.value, d.id, d.workflowOrder),
        locked: pathLocked(d.relativePath),
      })),
    ...previews.map((p) => ({
      id: previewNodeId(p.relativePath),
      title: p.title ?? previewLabel(p.relativePath),
      kind: 'HTML 실행',
      canvasId: p.canvasId,
      canvasName:
        canvasSheets.canvases.find((c) => c.id === canvasId(p.canvasId))
          ?.name ?? '',
      statusPropertyEnabled: p.statusPropertyEnabled,
      workflowStatusId: p.workflowStatusId,
      workflowOrder: kanbanOrder(
        kanbanView.value,
        p.sourceId!,
        p.workflowOrder,
      ),
      locked: pathLocked(p.relativePath) || pathLocked(p.sourcePath ?? ''),
    })),
  ];

  return {
    kanbanPreferences,
    kanbanDocuments,
    openKanbanControls,
    updateKanbanPreferences,
    kanbanLayouts,
    kanbanLayoutsRef,
    updateKanbanVisibility,
    kanbanVisibilityValue,
    toggleKanban,
    revealKanban,
  };
}
