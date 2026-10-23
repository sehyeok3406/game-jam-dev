import { NEW_FILE_GAP } from '../../canvas-placement.ts';
import { canvasId } from '../../canvas-sheets.ts';
import { textMaterialPath } from '../../canvas-text-materials.ts';
import { defaultDocumentTemplates } from '../../document-format.ts';
import {
  approvalOperationId,
  clearApprovalOperation,
  type ApprovalDetail,
  type ApprovalStart,
  type GamejamApproval,
} from '../../gamejam-approval.ts';
import {
  clearGamejamDraft,
  gamejamDraftScope,
  loadGamejamDraft,
  saveGamejamDraft,
} from '../../gamejam-history.ts';
import {
  gamejamTaskInput,
  resolveGamejamRequest,
} from '../../gamejam-request.ts';
import type {
  AiProviderId,
  CanvasDocument,
  CanvasSection,
  CodexConnectionStatus,
  CollaborationState,
  HtmlResultChoice,
  PreviewResult,
  PreviewWindowState,
} from '../../shared.ts';
import {
  DEFAULT_TASK_INSTRUCTIONS,
  defaultTaskInstructions,
} from '../../task-instructions.ts';
import type { SelectionScope } from '../canvas/selection-actions.ts';
import { useProjectLifetime } from '../workspace/useViewLifetime.ts';
import type { CanvasNode } from '../workspace/workspace-types.ts';
interface Ports {
  canWriteAiRequest: boolean;
  setNotice: import('react').Dispatch<import('react').SetStateAction<string>>;
  collaboration: CollaborationState;
  creatingTaskRef: import('react').RefObject<boolean>;
  flushMaterialDrafts: () => Promise<void>;
  locked: boolean;
  onBlocked: () => void;
  documents: CanvasDocument[];
  selectedIds: string[];
  sections: CanvasSection[];
  selectedSectionIds: string[];
  nodes: CanvasNode[];
  previewWindows: Record<string, PreviewWindowState>;
  previews: PreviewResult[];
  activeCanvas: string;
  initializeAiRequest: (
    request: import('../../gamejam-request').GamejamRequest,
    saved?: import('../../gamejam-history').GamejamSavedRequest,
    draft?: import('../../gamejam-history').GamejamDraft,
    approval?: { id: string; revision: number },
  ) => void;
  activeCanvasRef: import('react').RefObject<string>;
  noticeProject: string | null;
  preferences: import('../runtime/preferences.ts').PreferenceStore;
  selectedAiProvider: AiProviderId;
  selectedAiModel: string;
  selectedAiReasoning: import('../../shared').AiReasoningEffort | null;
  setApprovalCopyFrom: import('react').Dispatch<
    import('react').SetStateAction<string | undefined>
  >;
  setAiDraftStatus: import('react').Dispatch<
    import('react').SetStateAction<string>
  >;
  setApprovalInboxOpen: (
    value: import('react').SetStateAction<boolean>,
  ) => void;
  runTaskWithCodex: (
    task: Pick<CanvasDocument, 'relativePath' | 'title'>,
    approval?: ApprovalStart,
  ) => Promise<void>;
  aiRequest: import('../../gamejam-request').GamejamRequest | null;
  aiRequestPage: 1 | 2 | 3 | 4 | 5;
  aiRequestIssues: import('../../gamejam-validation').GamejamIssue[];
  focusAiIssue: (
    issue: import('../../gamejam-validation').GamejamIssue,
  ) => void;
  setAiRequestSubmitError: import('react').Dispatch<
    import('react').SetStateAction<string>
  >;
  setCreatingTask: import('react').Dispatch<
    import('react').SetStateAction<boolean>
  >;
  runScopeRef: import('react').RefObject<{
    project: string | null;
    home: boolean;
    sessionId: string | undefined;
  }>;
  editorsRef: import('react').RefObject<
    Map<string, (finish?: boolean) => Promise<void>>
  >;
  api: import('../../contracts/app-api.ts').AppApi;
  effectiveAiRequest: import('../../gamejam-request').GamejamRequest | null;
  loadProject: (fit?: boolean, throwOnError?: boolean) => Promise<void>;
  submittingApproval: boolean;
  editingApproval: { id: string; revision: number } | null;
  approvalCopyFrom: string | undefined;
  aiDraftScope: string | null;
  aiInstructionPage: 'organize' | 'implement';
  setSavedAiDraft: import('react').Dispatch<
    import('react').SetStateAction<
      import('../../gamejam-history').GamejamDraft | null
    >
  >;
  setAiRequest: import('react').Dispatch<
    import('react').SetStateAction<
      import('../../gamejam-request').GamejamRequest | null
    >
  >;
  setEditingApproval: import('react').Dispatch<
    import('react').SetStateAction<{ id: string; revision: number } | null>
  >;
  codexStatus: CodexConnectionStatus | null;
  aiRequestRetryOf: string | undefined;
  queueSupported: boolean;
  setAiResultPaths: import('react').Dispatch<
    import('react').SetStateAction<string[]>
  >;
  showError: (error: unknown) => void;
}
export function useAiRequestCommands(
  scope: SelectionScope,
  ports: () => Ports,
) {
  const isCurrent = useProjectLifetime(scope);
  const createTask = async (
    kind: 'organize' | 'implement' | 'both' = 'both',
    htmlResult?: HtmlResultChoice,
  ) => {
    const {
      canWriteAiRequest,
      setNotice,
      collaboration,
      creatingTaskRef,
      locked,
      onBlocked,
      documents,
      selectedIds,
      sections,
      selectedSectionIds,
      nodes,
      previewWindows,
      previews,
      activeCanvas,
      initializeAiRequest,
      activeCanvasRef,
    } = ports();

    if (!canWriteAiRequest) {
      setNotice(
        collaboration.role === 'editor'
          ? '편집자 AI 실행에는 서버 v0.8.0 이상이 필요합니다.'
          : 'AI 작업은 연결된 관리자·편집자가 실행할 수 있습니다.',
      );
      return;
    }
    if (creatingTaskRef.current) return;
    if (locked && !(collaboration.active && collaboration.role === 'editor')) {
      onBlocked();
      return;
    }
    const directlySelected = documents.filter((document) =>
      selectedIds.includes(document.id),
    );
    const selectedSections = sections.filter((section) =>
      selectedSectionIds.includes(section.id),
    );
    const sectionMemberKeys = new Set(
      selectedSections.flatMap((section) =>
        section.members.flatMap((member) => [member.id, member.path]),
      ),
    );
    const sectionDocuments = documents.filter(
      (document) =>
        sectionMemberKeys.has(document.id) ||
        sectionMemberKeys.has(document.relativePath),
    );
    const selectedMap = new Map(
      [...directlySelected, ...sectionDocuments].map((document) => [
        document.relativePath,
        document,
      ]),
    );
    const selected = [...selectedMap.values()];
    const textInputs = nodes.flatMap((node) =>
      node.selected &&
      node.data.kind === 'drawing' &&
      node.data.object.kind === 'text'
        ? [{ ...node.data.object, canvasId: activeCanvas }]
        : [],
    );
    const htmlInputs = nodes.filter(
      (node) => node.selected && node.data.kind === 'preview',
    );
    const htmlPreviews = htmlInputs.flatMap((node) =>
      node.data.kind === 'preview' ? [node.data.preview] : [],
    );
    const htmlInput = htmlPreviews.length === 1 ? htmlPreviews[0] : undefined;
    const htmlLayouts = htmlPreviews.map(
      (preview) =>
        previewWindows[preview.relativePath] ??
        preview.initialWindow ?? { x: 120, y: 120, width: 720, height: 520 },
    );
    const sourceMode =
      htmlPreviews.length > 1 || (htmlPreviews.length && kind === 'implement')
        ? ('html-compose' as const)
        : htmlInput
          ? ('html' as const)
          : undefined;
    const maxX = Math.max(
      ...textInputs.map((item) => item.transform.x + item.transform.width),
      ...(selected.length || selectedSections.length || htmlLayouts.length
        ? []
        : [20]),
      ...selected.map((document) => document.x + document.width),
      ...selectedSections.map((section) => section.x + section.width),
      ...htmlLayouts.map((layout) => layout.x + layout.width),
    );
    const minY = Math.min(
      ...textInputs.map((item) => item.transform.y),
      ...(selected.length || selectedSections.length || htmlLayouts.length
        ? []
        : [120]),
      ...selected.map((document) => document.y),
      ...selectedSections.map((section) => section.y),
      ...htmlLayouts.map((layout) => layout.y),
    );
    const inputPaths = [
      ...selectedSections.map((section) => section.relativePath),
      ...selected.map((document) => document.relativePath),
      ...htmlPreviews.map((preview) => preview.relativePath),
      ...textInputs.map(textMaterialPath),
    ];
    const resultX = maxX + 100;
    const resultY = Math.max(
      minY,
      ...previews
        .filter((preview) => canvasId(preview.canvasId) === activeCanvas)
        .flatMap((preview) =>
          previewWindows[preview.relativePath]
            ? [previewWindows[preview.relativePath]]
            : [],
        )
        .filter(
          (window) =>
            resultX < window.x + window.width + NEW_FILE_GAP &&
            resultX + 720 + NEW_FILE_GAP > window.x,
        )
        .map(
          (window) =>
            window.y + (window.collapsed ? 38 : window.height) + NEW_FILE_GAP,
        ),
    );
    initializeAiRequest({
      canvasId: activeCanvasRef.current,
      organize:
        sourceMode === 'html-compose'
          ? kind === 'organize'
          : kind !== 'implement',
      implement:
        sourceMode === 'html-compose'
          ? kind !== 'organize'
          : htmlInput
            ? kind === 'implement'
            : kind !== 'organize',
      sourceMode,
      inputPaths,
      x: resultX,
      y: resultY,
      htmlResult: htmlResult ?? {
        mode: 'new',
        ...(htmlInput ? { basePath: htmlInput.relativePath } : {}),
        ...(htmlPreviews.length > 1 ? { category: 'prototypes' } : {}),
      },
      documentResult: {
        mode: 'new',
        structure: 'custom',
        documents: defaultDocumentTemplates(),
      },
      instructions: {
        ...DEFAULT_TASK_INSTRUCTIONS,
        organize: defaultTaskInstructions('organize', sourceMode),
      },
      resultName: htmlInput?.title ?? '',
    });
  };

  const editApprovalRequest = (item: GamejamApproval, copy: boolean) => {
    const {
      collaboration,
      initializeAiRequest,
      noticeProject,
      preferences,
      selectedAiProvider,
      selectedAiModel,
      selectedAiReasoning,
      setApprovalCopyFrom,
      setAiDraftStatus,
      setApprovalInboxOpen,
    } = ports();

    if (!noticeProject) return;
    const scope = gamejamDraftScope(
      noticeProject,
      collaboration.memberId,
      copy ? undefined : item.id,
    );
    const draft = copy ? undefined : loadGamejamDraft(preferences, scope);
    const approval = copy
      ? undefined
      : (draft?.approval ?? { id: item.id, revision: item.revision });
    initializeAiRequest(
      draft?.request ?? item.request,
      {
        version: 1,
        request: item.request,
        providerId: selectedAiProvider,
        modelId: selectedAiModel,
        reasoningEffort: selectedAiReasoning,
      },
      draft,
      approval,
    );
    if (copy) setApprovalCopyFrom(item.id);
    if (draft?.approval && draft.approval.revision !== item.revision)
      setAiDraftStatus(
        '서버 요청이 변경되었습니다. 보관한 초안을 확인한 뒤 새 요청으로 전환하거나 요청함에서 최신 내용을 확인해주세요.',
      );
    else
      setAiDraftStatus(
        copy
          ? '이전 요청을 복사했습니다. 내용을 수정해 새 요청으로 등록하세요.'
          : '수정 저장을 눌러야 공유 요청에 반영됩니다. 구현 시작 전까지 수정할 수 있습니다.',
      );
    setApprovalInboxOpen(false);
  };
  const startApprovalRequest = async (
    detail: ApprovalDetail,
    commandId: string,
  ) => {
    const { runTaskWithCodex } = ports();

    if (!detail.reviewToken)
      throw new Error('최신 요청과 자료를 확인해주세요.');
    await runTaskWithCodex(
      {
        relativePath: '',
        title: detail.item.request.resultName || '팀원 요청',
      },
      {
        id: detail.item.id,
        revision: detail.item.revision,
        reviewToken: detail.reviewToken,
        commandId,
      },
    );
  };
  const submitAiRequest = async () => {
    const {
      setNotice,
      creatingTaskRef,
      noticeProject,
      preferences,
      selectedAiProvider,
      selectedAiModel,
      selectedAiReasoning,
      setApprovalInboxOpen,
      runTaskWithCodex,
      aiRequest,
      aiRequestPage,
      aiRequestIssues,
      focusAiIssue,
      setAiRequestSubmitError,
      setCreatingTask,
      runScopeRef,
      editorsRef,
      flushMaterialDrafts,
      api,
      effectiveAiRequest,
      loadProject,
      submittingApproval,
      editingApproval,
      approvalCopyFrom,
      aiDraftScope,
      aiInstructionPage,
      setSavedAiDraft,
      setAiRequest,
      setEditingApproval,
      codexStatus,
      aiRequestRetryOf,
      queueSupported,
      setAiResultPaths,
      showError,
    } = ports();

    if (!aiRequest || aiRequestPage !== 5 || creatingTaskRef.current) return;
    if (aiRequestIssues.length) {
      focusAiIssue(aiRequestIssues[0]);
      return;
    }
    setAiRequestSubmitError('');
    creatingTaskRef.current = true;
    setCreatingTask(true);
    const scope = runScopeRef.current;
    try {
      await flushMaterialDrafts();
      await Promise.all(
        [...editorsRef.current.values()].map((flush) => flush()),
      );
      if (!isCurrent()) return;
      const [
        latestDocuments,
        latestPreviews,
        latestCollaboration,
        latestDrawings,
      ] = await Promise.all([
        api.editor.listDocuments(),
        api.preview.listPreviews(),
        api.collaboration.getCollaboration(),
        api.editor.listDrawings(),
      ]);
      if (
        runScopeRef.current.project !== scope.project ||
        runScopeRef.current.home !== scope.home ||
        runScopeRef.current.sessionId !== scope.sessionId ||
        !isCurrent()
      )
        throw new Error(
          '프로젝트가 변경됐어요. 현재 프로젝트에서 요청을 다시 열어주세요.',
        );
      if (
        latestCollaboration.active &&
        (!latestCollaboration.connected ||
          latestCollaboration.pendingChanges ||
          latestCollaboration.accessDenied)
      )
        throw new Error(
          '자료의 저장과 프로젝트 연결을 확인한 뒤 다시 실행해주세요. 작성 내용은 보관됩니다.',
        );
      const request = resolveGamejamRequest(
        aiRequest,
        latestDocuments,
        latestPreviews,
        latestDrawings,
      );
      if (
        JSON.stringify(request.multiplayer) !==
        JSON.stringify(effectiveAiRequest?.multiplayer)
      ) {
        await loadProject(false, true);
        throw new Error(
          '입력 자료의 함께 플레이 설정이 바뀌었어요. 갱신된 최종 확인 내용을 확인해주세요.',
        );
      }
      if (submittingApproval) {
        const project = noticeProject;
        const current = await api.collaboration.getCollaboration();
        if (
          current.projectId !== project ||
          !current.connected ||
          current.accessDenied
        )
          throw new Error(
            '프로젝트 연결 상태를 확인해주세요. 작성 내용은 보관됩니다.',
          );
        if (current.pendingChanges)
          throw new Error(
            '입력 자료의 저장과 동기화를 완료한 뒤 요청해주세요.',
          );
        if (!isCurrent()) return;
        const signature = JSON.stringify([
          project,
          editingApproval,
          request,
          approvalCopyFrom,
        ]);
        if (
          !saveGamejamDraft(preferences, aiDraftScope!, {
            version: 1,
            request,
            providerId: selectedAiProvider,
            modelId: selectedAiModel,
            reasoningEffort: selectedAiReasoning,
            approval: editingApproval ?? undefined,
            copiedFrom: approvalCopyFrom,
            page: aiRequestPage,
            instructionPage: aiInstructionPage,
            updatedAt: Date.now(),
          })
        )
          throw new Error(
            '작성 내용을 보관하지 못했습니다. 저장 공간을 확인한 뒤 다시 요청해주세요.',
          );
        const commandId = approvalOperationId(
          preferences,
          aiDraftScope!,
          signature,
        );
        await api.ai.mutateApproval(editingApproval ? 'update' : 'create', {
          commandId,
          id: editingApproval?.id,
          revision: editingApproval?.revision,
          request,
          copiedFrom: approvalCopyFrom,
        });
        if (aiDraftScope) {
          clearGamejamDraft(preferences, aiDraftScope);
          clearApprovalOperation(preferences, aiDraftScope);
        }
        if (runScopeRef.current.project !== project || runScopeRef.current.home)
          return;
        setSavedAiDraft(null);
        setAiRequest(null);
        setEditingApproval(null);
        setApprovalInboxOpen(true);
        setNotice(
          editingApproval
            ? '요청 수정을 저장했습니다.'
            : '관리자에게 구현을 요청했습니다.',
        );
        return;
      }
      if (!codexStatus?.available || !codexStatus.authenticated)
        throw new Error(
          'AI 연결 설정에서 선택한 제공자의 연결을 먼저 확인해주세요.',
        );
      if (!isCurrent()) return;
      const task = await api.editor.createTask({
        ...gamejamTaskInput(request, {
          providerId: selectedAiProvider,
          modelId: selectedAiModel,
          reasoningEffort: selectedAiReasoning,
          retryOf: aiRequestRetryOf,
        }),
        queueVersion: queueSupported ? 1 : undefined,
      });
      if (!isCurrent()) return;
      setAiResultPaths([
        ...(aiRequest.organize
          ? [...task.body.matchAll(/`(docs\/[^`\r\n]+\.md)`/g)]
              .map((match) => match[1])
              .slice(-3)
          : []),
        ...(aiRequest.implement
          ? [...task.body.matchAll(/`(output\/[^`\r\n]+\.html)`/g)]
              .map((match) => match[1])
              .slice(-1)
          : []),
      ]);
      await loadProject(false);
      if (!isCurrent()) return;
      await runTaskWithCodex(task);
      if (!isCurrent()) return;
      if (aiDraftScope) clearGamejamDraft(preferences, aiDraftScope);
      setSavedAiDraft(null);
      setAiRequest(null);
    } catch (error) {
      if (!isCurrent()) return;
      setAiRequestSubmitError(
        error instanceof Error
          ? error.message
          : '실행 준비에 실패했습니다. 연결 상태와 입력을 확인한 뒤 다시 시도해주세요.',
      );
      showError(error);
    } finally {
      creatingTaskRef.current = false;
      if (isCurrent()) setCreatingTask(false);
    }
  };

  return {
    createTask,
    editApprovalRequest,
    startApprovalRequest,
    submitAiRequest,
  };
}
