import type { ReactFlowInstance } from '@xyflow/react';
import { verticalLayouts } from '../../canvas-placement.ts';
import { canvasId } from '../../canvas-sheets.ts';
import type { NoteBounds } from '../../note-placement.ts';
import type {
  CanvasDocument,
  CanvasSection,
  PreviewResult,
  PreviewWindowState,
  WorkspaceState,
} from '../../shared.ts';
import type { SelectionScope } from './selection-actions.ts';
import { useViewLifetime } from '../workspace/useViewLifetime.ts';
import type { CanvasNode } from '../workspace/workspace-types.ts';
interface Ports {
  workspace: WorkspaceState;
  openWorkspace: () => Promise<void>;
  locked: boolean;
  creatingNote: import('react').RefObject<boolean>;
  documents: CanvasDocument[];
  activeCanvas: string;
  sections: CanvasSection[];
  previews: PreviewResult[];
  previewWindows: Record<string, PreviewWindowState>;
  api: import('../../contracts/app-api.ts').AppApi;
  activeCanvasRef: import('react').RefObject<string>;
  loadProject: (fit?: boolean, throwOnError?: boolean) => Promise<void>;
  setNotice: import('react').Dispatch<import('react').SetStateAction<string>>;
  showError: (error: unknown) => void;
  flowRef: import('react').RefObject<ReactFlowInstance<CanvasNode> | null>;
}
export function useNoteCreation(scope: SelectionScope, ports: () => Ports) {
  const isCurrent = useViewLifetime(scope);
  const addIdeaAt = async (x: number, y: number, bounds?: NoteBounds) => {
    const {
      workspace,
      openWorkspace,
      locked,
      creatingNote,
      documents,
      activeCanvas,
      sections,
      previews,
      previewWindows,
      api,
      activeCanvasRef,
      loadProject,
      setNotice,
      showError,
    } = ports();

    if (!workspace.root) return openWorkspace();
    if (locked || creatingNote.current) return;
    creatingNote.current = true;
    try {
      const [automatic] = bounds
        ? []
        : verticalLayouts(
            [{ width: 340, height: 300 }],
            [
              ...documents.filter(
                (doc) => canvasId(doc.canvasId) === activeCanvas,
              ),
              ...sections.filter(
                (section) => canvasId(section.canvasId) === activeCanvas,
              ),
              ...previews
                .filter(
                  (preview) => canvasId(preview.canvasId) === activeCanvas,
                )
                .flatMap((preview) =>
                  previewWindows[preview.relativePath]
                    ? [previewWindows[preview.relativePath]]
                    : [],
                ),
            ].map((item) => ({
              ...item,
              height: 'collapsed' in item && item.collapsed ? 38 : item.height,
            })),
            { x, y },
          );
      const layout = bounds ?? automatic;
      const created = await api.editor.createIdea({
        x: layout.x,
        y: layout.y,
        ...(bounds ? { width: bounds.width, height: bounds.height } : {}),
        canvasId: activeCanvasRef.current,
      });
      if (!isCurrent()) return;
      // Older collaboration servers accept the creation command but omit its
      // optional dimensions. Apply the drawn bounds with their existing layout API.
      if (
        bounds &&
        (created.width !== bounds.width ||
          created.height !== bounds.height ||
          created.x !== bounds.x ||
          created.y !== bounds.y)
      ) {
        if (bounds.width < 120 || bounds.height < 38) {
          await api.editor.deleteDocument({
            documentId: created.id,
            relativePath: created.relativePath,
            revision: created.revision,
          });
          throw new Error(
            '이 크기로 메모를 만들려면 협업 서버를 v0.12.2 이상으로 업데이트해주세요. 메모는 추가하지 않았습니다.',
          );
        }
        await api.editor.updateDocumentLayout({
          relativePath: created.relativePath,
          objectId: created.id,
          revision: created.revision,
          structureRevision: created.structureRevision,
          position: true,
          size: true,
          ...bounds,
        });
      }
      if (!isCurrent()) return;
      await loadProject(false);
      setNotice('새 메모 파일을 만들었습니다. 카드를 클릭해 편집하세요.');
    } catch (error) {
      await loadProject(false);
      if (isCurrent()) showError(error);
    } finally {
      creatingNote.current = false;
    }
  };

  const addIdeaNearCenter = async () => {
    const { flowRef } = ports();

    const center = flowRef.current?.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    await addIdeaAt(center?.x ?? 160, center?.y ?? 140);
  };

  return { addIdeaNearCenter, addIdeaAt };
}
