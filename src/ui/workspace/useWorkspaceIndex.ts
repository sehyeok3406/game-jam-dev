import { useEffect, useState } from 'react';
import { canvasId } from '../../canvas-sheets.ts';
import { previewLabel } from '../../preview-output.ts';
import { previewViewport } from '../../preview-window.ts';
import type {
  CanvasDocument,
  CanvasSection,
  CanvasSheets,
  CollaborationState,
  FileAuthorship,
  HistoryEntry,
  PreviewResult,
  PreviewWindowState,
  WorkspaceState,
} from '../../shared.ts';
import type { CanvasItem } from '../CanvasOverlays';
import {
  previewNodeId,
  sectionNodeId,
  type CodexRunView,
} from './workspace-types.ts';

interface Ports {
  canvasSheets: CanvasSheets;
  collaboration: CollaborationState;
  sections: CanvasSection[];
  documents: CanvasDocument[];
  previews: PreviewResult[];
  previewWindows: Record<string, PreviewWindowState>;
  inspectorId: string | null;
  api: import('../../contracts/app-api').AppApi;
  workspace: WorkspaceState;
  codexRun: CodexRunView | null;
}
export function useWorkspaceIndex(ports: Ports) {
  const {
    canvasSheets,
    collaboration,
    sections,
    documents,
    previews,
    previewWindows,
    inspectorId,
    api,
    workspace,
    codexRun,
  } = ports;
  const [inspectorAuthorship, setInspectorAuthorship] = useState<{
    path: string;
    value?: FileAuthorship;
    error?: boolean;
  } | null>(null);
  const [inspectorAiRecords, setInspectorAiRecords] = useState<{
    path: string;
    entries?: HistoryEntry[];
    error?: boolean;
  } | null>(null);
  const canvasItems: CanvasItem[] = [];
  const listed = new Set<string>();
  const toItem = (doc: CanvasDocument, parent?: string): CanvasItem => ({
    canvasId: canvasId(doc.canvasId),
    canvasName: canvasSheets.canvases.find(
      (sheet) => sheet.id === canvasId(doc.canvasId),
    )?.name,
    id: doc.id,
    title: doc.title,
    kind:
      doc.type === 'image'
        ? 'image'
        : doc.type === 'reference'
          ? 'reference'
          : doc.type === 'idea'
            ? 'idea'
            : doc.type === 'ai-task'
              ? 'task'
              : 'document',
    path: doc.relativePath,
    description: doc.body,
    parent,
    editingBy: collaboration.locks.find(
      (lock) => lock.relativePath === doc.relativePath,
    )?.nickname,
  });
  for (const section of sections) {
    canvasItems.push({
      canvasId: canvasId(section.canvasId),
      canvasName: canvasSheets.canvases.find(
        (sheet) => sheet.id === canvasId(section.canvasId),
      )?.name,
      id: sectionNodeId(section.id),
      title: section.title,
      kind: 'section',
      path: section.relativePath,
      description: `포함 문서 ${section.members.length}개`,
    });
    for (const member of section.members) {
      const doc = documents.find(
        (doc) => doc.id === member.id || doc.relativePath === member.path,
      );
      if (doc) {
        listed.add(doc.id);
        canvasItems.push(toItem(doc, section.title));
      }
    }
  }
  for (const doc of documents)
    if (!listed.has(doc.id)) canvasItems.push(toItem(doc));
  for (const preview of previews)
    canvasItems.push({
      canvasId: canvasId(preview.canvasId),
      canvasName: canvasSheets.canvases.find(
        (sheet) => sheet.id === canvasId(preview.canvasId),
      )?.name,
      id: previewNodeId(preview.relativePath),
      title: preview.title ?? previewLabel(preview.relativePath),
      kind: 'html',
      path: preview.relativePath,
      description: previewWindows[preview.relativePath]
        ? `${previewViewport(previewWindows[preview.relativePath]).width} × ${previewViewport(previewWindows[preview.relativePath]).height}`
        : '',
    });
  const inspectorPath = canvasItems.find(
    (item) => item.id === inspectorId,
  )?.path;
  const inspectorVersion =
    documents.find((doc) => doc.id === inspectorId)?.modifiedAt ??
    sections.find((section) => sectionNodeId(section.id) === inspectorId)
      ?.modifiedAt ??
    previews.find(
      (preview) => previewNodeId(preview.relativePath) === inspectorId,
    )?.content;
  useEffect(() => {
    if (!inspectorPath) {
      setInspectorAuthorship(null);
      return;
    }
    let cancelled = false;
    setInspectorAuthorship({ path: inspectorPath });
    void api.history
      .getFileAuthorship(inspectorPath)
      .then((value) => {
        if (!cancelled) setInspectorAuthorship({ path: inspectorPath, value });
      })
      .catch(() => {
        if (!cancelled)
          setInspectorAuthorship({ path: inspectorPath, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [inspectorPath, inspectorVersion, workspace.root, collaboration.revision]);

  useEffect(() => {
    if (!inspectorPath || inspectorPath.startsWith('sections/')) {
      setInspectorAiRecords(null);
      return;
    }
    let cancelled = false;
    setInspectorAiRecords({ path: inspectorPath });
    void api.history
      .listHistory()
      .then((entries) => {
        if (!cancelled) setInspectorAiRecords({ path: inspectorPath, entries });
      })
      .catch(() => {
        if (!cancelled)
          setInspectorAiRecords({ path: inspectorPath, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [
    inspectorPath,
    inspectorVersion,
    workspace.root,
    collaboration.revision,
    codexRun?.status,
  ]);

  return { canvasItems, inspectorAuthorship, inspectorAiRecords };
}
