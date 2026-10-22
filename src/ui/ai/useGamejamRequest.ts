import { flushSync } from 'react-dom';
import { gamejamFieldId, type GamejamIssue } from '../../gamejam-validation';
import { gamejamFieldPage } from '../../gamejam-wizard';
import { useState, useRef, useEffect } from 'react';
import { useRuntime } from '../runtime/RuntimeProvider';
import type { AiProviderId, AiReasoningEffort } from '../../contracts/ai';
import type { GamejamRequest } from '../../contracts/gamejam-request';
import type { HistoryEntry } from '../../contracts/history';
import type { CanvasSheet } from '../../contracts/canvas';
import { reasoningError } from '../../core/ai/catalog.ts';
import {
  gamejamDraftScope,
  loadGamejamDraft,
  saveGamejamDraft,
  entryRequest,
  type GamejamDraft,
  type GamejamSavedRequest,
} from '../../gamejam-history';
import type { GamejamPage } from '../../gamejam-wizard';

type RequestScope = {
  project: string | null;
  memberId?: string;
  sessionId?: string;
  home: boolean;
  canvases: CanvasSheet[];
  activeCanvas: string;
  onProviderChanged: () => void;
  onOpen: () => void;
};

/** Request drafts, provider selection and async history reads belong to this project session. */
export function useGamejamRequest({
  project: noticeProject,
  memberId,
  sessionId,
  home,
  canvases,
  activeCanvas,
  onProviderChanged,
  onOpen,
}: RequestScope) {
  const { api, preferences } = useRuntime();
  const sourceRef = useRef({ project: noticeProject, sessionId });
  sourceRef.current = { project: noticeProject, sessionId };
  const [aiRequest, setAiRequest] = useState<GamejamRequest | null>(null);
  const [editingApproval, setEditingApproval] = useState<{
    id: string;
    revision: number;
  } | null>(null);
  const [approvalCopyFrom, setApprovalCopyFrom] = useState<
    string | undefined
  >();
  const [aiRequestPage, setAiRequestPage] = useState<GamejamPage>(1);
  const [aiRequestVisited, setAiRequestVisited] = useState(1);
  const [aiInstructionPage, setAiInstructionPage] = useState<
    'organize' | 'implement'
  >('organize');
  const [aiRequestSubmitError, setAiRequestSubmitError] = useState('');
  const [savedAiDraft, setSavedAiDraft] = useState<GamejamDraft | null>(null);
  const [aiDraftStatus, setAiDraftStatus] = useState('');
  const [aiRequestRetryOf, setAiRequestRetryOf] = useState<
    string | undefined
  >();
  const [loadingAiRequest, setLoadingAiRequest] = useState(false);
  const aiRequestProjectRef = useRef<string | null>(null);
  const requestSession = useRef(sessionId);
  const aiDraftSignatureRef = useRef('');
  const aiRequestLoadRef = useRef(0);
  const aiRequestDialogRef = useRef<HTMLElement>(null);
  const aiDraftScope = noticeProject
    ? gamejamDraftScope(noticeProject, memberId, editingApproval?.id)
    : null;
  const [selectedAiProvider, setSelectedAiProvider] =
    useState<AiProviderId>('codex-cli');
  const [selectedAiModel, setSelectedAiModel] = useState('');
  const [selectedAiReasoning, setSelectedAiReasoning] =
    useState<AiReasoningEffort | null>(null);
  const changeAiModel = (model: string) => {
    setSelectedAiModel(model);
    setSelectedAiReasoning((current) =>
      reasoningError(selectedAiProvider, model, current) ? null : current,
    );
  };
  useEffect(() => {
    if (
      !aiRequest ||
      !noticeProject ||
      home ||
      aiRequestProjectRef.current !== noticeProject ||
      requestSession.current !== sessionId
    )
      return;
    const draft: GamejamDraft = {
      approval: editingApproval ?? undefined,
      copiedFrom: approvalCopyFrom,
      version: 1,
      request: aiRequest,
      providerId: selectedAiProvider,
      modelId: selectedAiModel,
      reasoningEffort: selectedAiReasoning,
      retryOf: aiRequestRetryOf,
      page: aiRequestPage,
      instructionPage: aiInstructionPage,
      updatedAt: Date.now(),
    };
    const signature = JSON.stringify({ ...draft, updatedAt: 0 });
    if (aiDraftSignatureRef.current === signature) return;
    if (saveGamejamDraft(preferences, aiDraftScope!, draft)) {
      aiDraftSignatureRef.current = signature;
      setAiDraftStatus('작성 내용 자동 저장됨 · 이 기기에 보관');
    } else {
      setAiDraftStatus(
        '작성 내용을 저장하지 못했습니다. 창을 닫기 전에 지시를 복사해주세요.',
      );
    }
  }, [
    aiRequest,
    aiRequestPage,
    aiInstructionPage,
    selectedAiProvider,
    selectedAiModel,
    selectedAiReasoning,
    aiRequestRetryOf,
    noticeProject,
    aiDraftScope,
    editingApproval,
    approvalCopyFrom,
    home,
  ]);
  useEffect(
    () => () => {
      aiRequestLoadRef.current++;
    },
    [],
  );
  useEffect(() => {
    setEditingApproval(null);
    setApprovalCopyFrom(undefined);
    aiRequestLoadRef.current++;
    setLoadingAiRequest(false);
  }, [noticeProject, sessionId]);
  useEffect(() => {
    setAiRequestSubmitError('');
  }, [aiRequest, selectedAiProvider, selectedAiModel, selectedAiReasoning]);
  const initializeAiRequest = (
    request: GamejamRequest,
    saved?: GamejamSavedRequest,
    draft?: GamejamDraft,
    approval?: { id: string; revision: number },
  ) => {
    if (!noticeProject) return;
    const editing = approval ?? draft?.approval;
    setEditingApproval(editing ?? null);
    setApprovalCopyFrom(draft?.copiedFrom);
    const draftScope = gamejamDraftScope(noticeProject, memberId, editing?.id);
    aiRequestLoadRef.current += 1;
    setLoadingAiRequest(false);
    const providerId = saved?.providerId ?? selectedAiProvider;
    const modelId = saved?.modelId ?? selectedAiModel;
    const reasoningEffort = saved
      ? (saved.reasoningEffort ?? null)
      : selectedAiReasoning;
    const page = draft?.page ?? 1;
    const instructionPage = draft?.instructionPage ?? 'organize';
    const restored = structuredClone(request);
    if (!canvases.some((sheet) => sheet.id === restored.canvasId))
      restored.canvasId = activeCanvas;
    aiRequestProjectRef.current = noticeProject;
    requestSession.current = sessionId;
    aiDraftSignatureRef.current = JSON.stringify({
      version: 1,
      request: restored,
      providerId,
      modelId,
      reasoningEffort,
      retryOf: saved?.retryOf,
      page,
      instructionPage,
      updatedAt: 0,
    });
    setSavedAiDraft(loadGamejamDraft(preferences, draftScope) ?? null);
    setAiDraftStatus(
      saved
        ? '이전 요청을 불러왔습니다. 입력 자료와 결과 설정을 확인해주세요.'
        : '변경한 작성 내용은 이 기기에 자동 저장됩니다.',
    );
    setAiRequestRetryOf(saved?.retryOf);
    setAiRequestPage(page);
    setAiRequestVisited(page);
    setAiInstructionPage(instructionPage);
    setAiRequestSubmitError('');
    if (providerId !== selectedAiProvider) onProviderChanged();
    setSelectedAiProvider(providerId);
    setSelectedAiModel(modelId);
    setSelectedAiReasoning(reasoningEffort);
    onOpen();
    setAiRequest(restored);
    // A reused request also survives closing the dialog before editing anything.
    if (saved) {
      const value: GamejamDraft = {
        approval: editing,
        ...saved,
        request: restored,
        page,
        instructionPage,
        updatedAt: Date.now(),
      };
      if (!saveGamejamDraft(preferences, draftScope, value))
        setAiDraftStatus('이전 요청을 불러왔지만 임시 저장에 실패했습니다.');
    }
    const version = aiRequestLoadRef.current;
    requestAnimationFrame(() => {
      if (
        version !== aiRequestLoadRef.current ||
        sourceRef.current.project !== noticeProject ||
        sourceRef.current.sessionId !== sessionId
      )
        return;
      const fields =
        aiRequestDialogRef.current?.querySelector('.ai-request-fields');
      if (fields) fields.scrollTop = 0;
      aiRequestDialogRef.current
        ?.querySelector<HTMLElement>(
          `[data-gamejam-page="${page}"] .ai-step-heading`,
        )
        ?.focus({ preventScroll: true });
    });
  };
  const closeAiRequest = () => {
    aiRequestLoadRef.current += 1;
    setLoadingAiRequest(false);
    setAiRequest(null);
  };
  const reuseAiEntry = (entry: HistoryEntry) => {
    const saved = entryRequest(entry);
    if (!saved) return;
    initializeAiRequest(saved.request, saved);
  };
  const loadRecentAiRequest = async () => {
    const project = noticeProject,
      session = sessionId,
      version = ++aiRequestLoadRef.current;
    setLoadingAiRequest(true);
    try {
      const entries = await api.history.listHistory();
      if (
        sourceRef.current.project !== project ||
        sourceRef.current.sessionId !== session ||
        aiRequestLoadRef.current !== version
      )
        return;
      const latest = entries.find((entry) => entryRequest(entry));
      if (latest) reuseAiEntry(latest);
      else setAiDraftStatus('불러올 작업 기록이 없습니다.');
    } catch (error) {
      if (
        sourceRef.current.project === project &&
        sourceRef.current.sessionId === session &&
        aiRequestLoadRef.current === version
      )
        setAiDraftStatus(
          `최근 요청을 불러오지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
        );
    } finally {
      if (aiRequestLoadRef.current === version) setLoadingAiRequest(false);
    }
  };

  const activeAiInstruction =
    aiRequest?.organize && aiRequest?.implement
      ? aiInstructionPage
      : aiRequest?.organize
        ? 'organize'
        : 'implement';
  const navigateAiPage = (
    page: GamejamPage,
    instruction?: 'organize' | 'implement',
  ) => {
    flushSync(() => {
      setAiRequestPage(page);
      setAiRequestVisited((visited) => Math.max(visited, page));
      if (page === 3)
        setAiInstructionPage(
          instruction ?? (aiRequest?.organize ? 'organize' : 'implement'),
        );
    });
    const fields =
      aiRequestDialogRef.current?.querySelector('.ai-request-fields');
    if (fields) fields.scrollTop = 0;
    aiRequestDialogRef.current
      ?.querySelector<HTMLElement>(
        `[data-gamejam-page="${page}"] .ai-step-heading`,
      )
      ?.focus({ preventScroll: true });
  };
  const focusAiIssue = (issue: GamejamIssue) => {
    flushSync(() => {
      const page = gamejamFieldPage(issue.field);
      setAiRequestPage(page);
      setAiRequestVisited((visited) => Math.max(visited, page));
      if (issue.field === 'organize' || issue.field === 'implement')
        setAiInstructionPage(issue.field);
    });
    const target =
      aiRequestDialogRef.current?.querySelector<HTMLElement>(
        `#${gamejamFieldId(issue.field)}`,
      ) ??
      aiRequestDialogRef.current?.querySelector<HTMLElement>(
        '#ai-request-status',
      );
    if (!target) return;
    for (
      let ancestor: HTMLElement | null = target;
      ancestor && ancestor !== aiRequestDialogRef.current;
      ancestor = ancestor.parentElement
    ) {
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
    }
    target.focus({ preventScroll: true });
    const scrollTarget =
      target instanceof HTMLDetailsElement
        ? (target.querySelector('summary') ?? target)
        : target;
    scrollTarget.scrollIntoView({
      block: 'center',
      behavior: 'instant',
    });
  };
  const advanceAiPage = (issues: GamejamIssue[]) => {
    if (issues.length) {
      focusAiIssue(issues[0]);
      return;
    }
    if (
      aiRequestPage === 3 &&
      aiRequest?.organize &&
      aiRequest.implement &&
      activeAiInstruction === 'organize'
    ) {
      navigateAiPage(3, 'implement');
    } else if (aiRequestPage < 5) {
      navigateAiPage((aiRequestPage + 1) as GamejamPage);
    }
  };
  const previousAiPage = () => {
    if (
      aiRequestPage === 3 &&
      aiRequest?.organize &&
      aiRequest.implement &&
      activeAiInstruction === 'implement'
    ) {
      navigateAiPage(3, 'organize');
    } else if (aiRequestPage > 1) {
      navigateAiPage(
        (aiRequestPage - 1) as GamejamPage,
        aiRequest?.implement ? 'implement' : 'organize',
      );
    }
  };
  return {
    aiRequest,
    setAiRequest,
    editingApproval,
    setEditingApproval,
    approvalCopyFrom,
    setApprovalCopyFrom,
    aiRequestPage,
    setAiRequestPage,
    aiRequestVisited,
    setAiRequestVisited,
    aiInstructionPage,
    setAiInstructionPage,
    aiRequestSubmitError,
    setAiRequestSubmitError,
    savedAiDraft,
    setSavedAiDraft,
    aiDraftStatus,
    setAiDraftStatus,
    aiRequestRetryOf,
    loadingAiRequest,
    aiRequestDialogRef,
    selectedAiProvider,
    setSelectedAiProvider,
    selectedAiModel,
    setSelectedAiModel,
    selectedAiReasoning,
    setSelectedAiReasoning,
    changeAiModel,
    activeAiInstruction,
    navigateAiPage,
    focusAiIssue,
    advanceAiPage,
    previousAiPage,
    aiDraftScope,
    initializeAiRequest,
    closeAiRequest,
    reuseAiEntry,
    loadRecentAiRequest,
  };
}
