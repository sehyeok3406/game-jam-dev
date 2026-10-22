import { useCallback, useRef } from 'react';
import type { KanbanDocument } from '../../features/kanban/KanbanBoardContent';
import type { KanbanView } from '../../features/kanban/view.ts';
import {
  statusPropertyApplied,
  type StatusPropertyInput,
} from '../../file-properties.ts';
import type { CanvasDocument, PreviewResult } from '../../shared.ts';
import {
  selectionScopeKey,
  type SelectionScope,
} from '../canvas/selection-actions.ts';
import { useScopedPrompt } from '../canvas/useSelectionActions.ts';
import { useViewLifetime } from '../workspace/useViewLifetime.ts';
import { previewNodeId } from '../workspace/workspace-types.ts';
interface Ports {
  workflowEditable: boolean;
  api: import('../../contracts/app-api.ts').AppApi;
  loadProject: (fit?: boolean, throwOnError?: boolean) => Promise<void>;
  showError: (error: unknown) => void;
  documents: CanvasDocument[];
  previews: PreviewResult[];
  kanbanView: { value: KanbanView; raw: string | null };
}
export function useFileWorkflow(scope: SelectionScope, ports: () => Ports) {
  const key = selectionScopeKey(scope);
  const isCurrent = useViewLifetime(scope);
  const live = useRef(ports);
  live.current = ports;
  const [workflowBusy, setWorkflowBusy] = useScopedPrompt(key, false);
  const workflowPending = useRef(false);

  const workflowChange = useCallback(
    async (input: StatusPropertyInput) => {
      const { workflowEditable, api, loadProject } = live.current();

      if (workflowPending.current)
        throw Error('이전 상태 저장이 끝난 뒤 다시 선택해주세요.');
      if (!workflowEditable)
        throw Error('상태 편집 권한이 없거나 협업 서버 업데이트가 필요합니다.');
      workflowPending.current = true;
      setWorkflowBusy(true);
      try {
        await api.editor.setFileStatusProperty(input);
        if (isCurrent()) await loadProject(false);
      } finally {
        workflowPending.current = false;
        setWorkflowBusy(false);
      }
    },
    [isCurrent],
  );
  const setWorkflow = useCallback(
    (doc: CanvasDocument, id: string) => {
      const { showError } = live.current();

      void workflowChange({
        relativePath: doc.relativePath,
        objectId: doc.id,
        expectedEnabled: statusPropertyApplied(doc),
        expectedStatus: doc.workflowStatusId,
        expectedOrder: doc.workflowOrder,
        workflowRevision: doc.workflowRevision,
        structureRevision: doc.structureRevision,
        statusId: id,
      }).catch(showError);
    },
    [isCurrent],
  );
  const moveKanbanCard = useCallback(
    async (
      item: KanbanDocument,
      statusId: string,
      beforeId?: string,
      afterId?: string,
    ) => {
      const { api, loadProject, documents, previews, kanbanView } =
        live.current();

      const doc = documents.find((d) => d.id === item.id),
        p = previews.find((p) => previewNodeId(p.relativePath) === item.id);
      if (!doc && !p) throw Error('문서가 이동되거나 삭제되었습니다.');
      const resolveId = (id?: string) =>
        previews.find((p) => previewNodeId(p.relativePath) === id)?.sourceId ??
        id;
      if (workflowPending.current)
        throw Error('이전 속성 저장이 끝난 뒤 다시 시도해주세요.');
      workflowPending.current = true;
      setWorkflowBusy(true);
      try {
        await api.editor.moveKanbanCard({
          expectedView: kanbanView.raw,
          expectedEnabled: statusPropertyApplied(item),
          relativePath: doc?.relativePath ?? p!.relativePath,
          objectId: doc?.id ?? p!.sourceId!,
          expectedStatus: item.workflowStatusId,
          expectedOrder: item.workflowOrder,
          workflowRevision: doc?.workflowRevision,
          structureRevision: doc?.structureRevision,
          statusId,
          beforeId: resolveId(beforeId),
          afterId: resolveId(afterId),
        });
        if (isCurrent()) await loadProject(false);
      } finally {
        workflowPending.current = false;
        setWorkflowBusy(false);
      }
    },
    [isCurrent],
  );

  return { workflowBusy, setWorkflow, workflowChange, moveKanbanCard };
}
