import { useCallback, useEffect, useRef, useState } from 'react';
import {
  completionDismissed,
  dismissCompletion,
  dismissRunPanel,
  runPanelDismissed,
} from '../../ai-completion-notices.ts';
import type { AiQueueTask } from '../../ai-task-queue.ts';
import type { ApprovalStart } from '../../gamejam-approval.ts';
import type {
  CanvasDocument,
  CodexConnectionStatus,
  CodexRunEvent,
  CollaborationState,
  WorkspaceState,
} from '../../shared.ts';
import { getAiProvider } from './presentation.ts';
import { uiPreview } from '../debug/uiDebugPreviewState.ts';
import { useScopedPrompt } from '../canvas/useSelectionActions.ts';
import type { CodexRunView } from '../workspace/workspace-types.ts';
interface Data {
  noticeProject: string | null;
  preferences: import('../runtime/preferences').PreferenceStore;
  setApprovalInboxOpen: (
    value: import('react').SetStateAction<boolean>,
  ) => void;
  taskDocuments: CanvasDocument[];
  aiResultPaths: string[];
  home: boolean;
  collaboration: CollaborationState;
  workspace: WorkspaceState;
  capabilities: Readonly<{
    localFiles: boolean;
    localAiExecution: boolean;
    selfHostManagement: boolean;
    appUpdates: boolean;
    nativeClipboard: boolean;
    multiplayer: boolean;
  }>;
  selectedAiProvider: import('../../shared').AiProviderId;
  api: import('../../contracts/app-api').AppApi;
  runScopeRef: import('react').RefObject<{
    project: string | null;
    home: boolean;
    sessionId: string | undefined;
  }>;

  selectedAiModel: string;
  selectedAiReasoning: import('../../shared').AiReasoningEffort | null;
  setInspectorId: import('react').Dispatch<
    import('react').SetStateAction<string | null>
  >;
  setHistoryOpen: (value: import('react').SetStateAction<boolean>) => void;
  setSettingsOpen: (value: import('react').SetStateAction<boolean>) => void;
}

interface Ports {
  queueSupported: boolean;
  showError: (error: unknown) => void;
  setNotice: import('react').Dispatch<import('react').SetStateAction<string>>;
  loadProject: (fit?: boolean, throwOnError?: boolean) => Promise<void>;
  canRunAi: boolean;
  aiBusy: boolean;
  locked: boolean;
  onBlocked: () => void;
  editorsRef: import('react').RefObject<
    Map<string, (finish?: boolean) => Promise<void>>
  >;
}
export function useAiRun(data: Data, ports: () => Ports) {
  const {
    noticeProject,
    preferences,
    setApprovalInboxOpen,
    taskDocuments,
    aiResultPaths,
    home,
    collaboration,
    workspace,
    capabilities,
    selectedAiProvider,
    api,
    runScopeRef,
    selectedAiModel,
    selectedAiReasoning,
    setInspectorId,
    setHistoryOpen,
    setSettingsOpen,
  } = data;
  const codexLogsRef = useRef<HTMLDivElement>(null);
  const live = useRef(ports);
  live.current = ports;
  const operationScope = useRef({ key: '', version: 0 });
  const scopeKey = JSON.stringify([
    noticeProject,
    home,
    workspace.session?.sessionId,
  ]);
  if (operationScope.current.key !== scopeKey)
    operationScope.current = {
      key: scopeKey,
      version: operationScope.current.version + 1,
    };
  const version = operationScope.current.version;
  const [preparingTask, setPreparingTask] = useScopedPrompt(
    String(version),
    false,
  );
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const currentOperation = () =>
    mounted.current && operationScope.current.version === version;
  const starting = useRef<number | null>(null);
  const loadProject = useCallback(
    (...args: Parameters<Ports['loadProject']>) =>
      live.current().loadProject(...args),
    [],
  );
  const showError = (error: unknown) => live.current().showError(error);
  const setNotice = (value: React.SetStateAction<string>) =>
    live.current().setNotice(value);
  const [codexStatus, setCodexStatus] = useState<CodexConnectionStatus | null>(
    null,
  );
  const [codexRun, setCodexRun] = useState<CodexRunView | null>(null);
  const [aiQueue, setAiQueue] = useState<AiQueueTask[]>([]);
  const [codexRunCollapsed, setCodexRunCollapsed] = useState(true);
  const [completion, setCompletion] = useState<{
    project: string;
    runId: string;
    status: 'completed' | 'failed';
    taskPath: string;
  } | null>(null);
  const notifiedRuns = useRef(new Set<string>());

  const [dismissedPanels, setDismissedPanels] = useState(new Set<string>());
  const runPanelVisible =
    !!codexRun &&
    codexRun.project === noticeProject &&
    !dismissedPanels.has(JSON.stringify([codexRun.project, codexRun.runId])) &&
    !runPanelDismissed(preferences, codexRun.project, codexRun.runId);
  const completionVisible =
    runPanelVisible &&
    !!completion &&
    completion.project === codexRun?.project &&
    completion.runId === codexRun?.runId &&
    codexRunCollapsed;
  const closeCompletion = () => {
    if (completion) {
      dismissCompletion(preferences, completion.project, completion.runId);
      notifiedRuns.current.add(
        JSON.stringify([completion.project, completion.runId]),
      );
    }
    setCompletion(null);
  };
  const closeRunPanel = () => {
    if (!codexRun) return;
    dismissRunPanel(preferences, codexRun.project, codexRun.runId);
    const key = JSON.stringify([codexRun.project, codexRun.runId]);
    setDismissedPanels((current) => new Set(current).add(key));
    notifiedRuns.current.add(key);
    setCompletion(null);
  };
  useEffect(() => {
    setCodexRun((current) =>
      current?.project === noticeProject ? current : null,
    );
    setCompletion((current) =>
      current?.project === noticeProject ? current : null,
    );
    setApprovalInboxOpen(false);
  }, [noticeProject]);

  const runFailure = codexRun?.events.findLast(
    (event) => event.failure,
  )?.failure;
  const runTaskBody =
    taskDocuments.find((doc) => doc.relativePath === codexRun?.taskPath)
      ?.body ?? '';
  const outputMatches = [
    ...runTaskBody.matchAll(/`((?:output|docs)\/[^`]+\.(?:html|md))`/g),
  ].map((match) => match[1]);
  const runOutputPaths = outputMatches.length
    ? outputMatches.slice(
        outputMatches.some((path) => path.endsWith('.html')) ? -1 : -3,
      )
    : aiResultPaths;
  useEffect(() => {
    if (!codexRun || !runPanelVisible || home) return;
    if (['starting', 'running', 'validating'].includes(codexRun.status)) {
      setCompletion(null);
      return;
    }
    if (
      (codexRun.status === 'completed' || codexRun.status === 'failed') &&
      !notifiedRuns.current.has(
        JSON.stringify([codexRun.project, codexRun.runId]),
      ) &&
      !completionDismissed(preferences, codexRun.project, codexRun.runId)
    ) {
      notifiedRuns.current.add(
        JSON.stringify([codexRun.project, codexRun.runId]),
      );
      setCompletion({
        project: codexRun.project,
        runId: codexRun.runId,
        status: codexRun.status,
        taskPath: codexRun.taskPath,
      });
      if (uiPreview()?.id !== 'ai-run') setCodexRunCollapsed(true);
    }
  }, [codexRun, runPanelVisible, home]);
  const [cancellingCodexRun, setCancellingCodexRun] = useState(false);
  const [checkingCodex, setCheckingCodex] = useState(false);

  const statusRequestRef = useRef(0);
  const refreshCodexStatus = useCallback(async () => {
    if (!capabilities.localAiExecution) {
      const status: CodexConnectionStatus = {
        providerId: selectedAiProvider,
        available: false,
        authenticated: false,
        version: null,
        executablePath: null,
        message: 'AI 실행은 CLI가 연결된 PC 앱에서 사용할 수 있습니다.',
      };
      setCodexStatus(status);
      return status;
    }
    const request = ++statusRequestRef.current;
    setCheckingCodex(true);
    try {
      const status = await api.ai.getAiStatus(selectedAiProvider);
      if (currentOperation() && request === statusRequestRef.current)
        setCodexStatus(status);
      return status;
    } catch (error) {
      if (currentOperation()) showError(error);
      return null;
    } finally {
      if (currentOperation() && request === statusRequestRef.current)
        setCheckingCodex(false);
    }
  }, [selectedAiProvider, capabilities.localAiExecution, version]);

  useEffect(() => {
    void refreshCodexStatus();
    if (!noticeProject || home || !capabilities.localAiExecution) return;
    let active = true;
    void api.ai
      .getActiveRun()
      .then((event) => {
        if (event && active)
          setCodexRun(
            (current) =>
              current ?? {
                project: noticeProject,
                runId: event.runId,
                taskPath: event.taskPath,
                status: event.status,
                fileLock: event.fileLock,
                events: [event],
                providerId: event.providerId ?? 'codex-cli',
                modelId: event.modelId ?? null,
                reasoningEffort: event.reasoningEffort,
              },
          );
      })
      .catch(showError);
    return () => {
      active = false;
    };
  }, [refreshCodexStatus, noticeProject, home]);

  useEffect(
    () =>
      api.ai.onCodexRunEvent((event) => {
        if (
          event.projectSession &&
          event.projectSession.sessionId !== runScopeRef.current.sessionId
        )
          return;
        const { project, home: atHome } = runScopeRef.current;
        if (project && !atHome)
          setCodexRun((current) => {
            const sameRun =
              current?.runId === event.runId && current.project === project;
            const events = sameRun ? current.events : ([] as CodexRunEvent[]);
            return {
              project,
              runId: event.runId,
              taskPath: event.taskPath,
              status: event.status,
              fileLock:
                event.fileLock ?? (sameRun ? current.fileLock : undefined),
              events: [...events, event].slice(-300),
              providerId:
                event.providerId ??
                (sameRun ? current.providerId : 'codex-cli'),
              modelId: event.modelId ?? (sameRun ? current.modelId : null),
              reasoningEffort:
                event.reasoningEffort === undefined && sameRun
                  ? current.reasoningEffort
                  : event.reasoningEffort,
            };
          });
        if (event.status === 'completed') {
          setCancellingCodexRun(false);
          setNotice('AI 작업이 완료되어 결과 파일을 불러왔습니다.');
          void loadProject(false);
        } else if (event.status === 'failed') {
          setCancellingCodexRun(false);
          setNotice(`AI 작업 실패: ${event.message}`);
          void loadProject(false);
        } else if (event.status === 'cancelled') {
          setCancellingCodexRun(false);
          setNotice('AI 작업을 취소했습니다.');
          void loadProject(false);
        }
      }),
    [loadProject],
  );

  useEffect(() => {
    if (!codexRun || codexRunCollapsed) return;
    const frame = requestAnimationFrame(() => {
      const logs = codexLogsRef.current;
      if (logs) logs.scrollTop = logs.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [codexRun, codexRunCollapsed]);

  const runTaskWithCodex = async (
    task: Pick<CanvasDocument, 'relativePath' | 'title'>,
    approval?: ApprovalStart,
  ) => {
    const { queueSupported, canRunAi, aiBusy, locked, onBlocked, editorsRef } =
      ports();

    if (!capabilities.localAiExecution)
      throw new Error('AI 실행은 CLI가 연결된 PC 앱에서 사용할 수 있습니다.');
    if (!canRunAi) throw new Error('관리자만 AI를 실행할 수 있습니다.');
    if (aiBusy && !queueSupported) {
      if (approval)
        throw new Error(
          '이미 AI 작업이 진행 중입니다. 완료하거나 중지한 뒤 승인해주세요.',
        );
      return setNotice(
        '이미 AI 작업이 진행 중입니다. 완료하거나 중지해주세요.',
      );
    }
    if (locked) {
      if (approval)
        throw new Error('프로젝트 연결과 저장 상태를 확인한 뒤 승인해주세요.');
      onBlocked();
      return;
    }
    if (!currentOperation() || starting.current === version) return;
    starting.current = version;
    try {
      await Promise.all(
        [...editorsRef.current.values()].map((flush) => flush()),
      );
      if (!currentOperation()) return;
      setPreparingTask(true);
      const status = approval
        ? await refreshCodexStatus()
        : (codexStatus ?? (await refreshCodexStatus()));
      if (!currentOperation()) return;
      if (!status?.available || !status.authenticated)
        throw new Error(
          status?.message ?? '선택한 AI CLI 연결을 확인할 수 없습니다.',
        );
      const project = noticeProject;
      if (!project) throw new Error('프로젝트를 먼저 열어주세요.');
      const result = await api.ai.startCodexRun({
        queueVersion: queueSupported ? 1 : undefined,
        approval,
        taskPath: task.relativePath,
        providerId: selectedAiProvider,
        modelId: selectedAiModel || null,
        reasoningEffort: selectedAiReasoning,
      });
      if (
        !currentOperation() ||
        runScopeRef.current.project !== project ||
        runScopeRef.current.home
      )
        return;
      if (result.status === 'queued') {
        setNotice(
          `'${task.title}' 작업을 예약했습니다. 등록 순서대로 실행합니다.`,
        );
        await loadProject(false);
        return;
      }
      setCodexRun((current) =>
        current?.runId === result.runId
          ? {
              ...current,
              providerId: result.providerId,
              modelId: result.modelId,
              reasoningEffort: result.reasoningEffort,
            }
          : {
              project,
              runId: result.runId,
              taskPath: result.taskPath,
              status: result.status,
              events: [],
              providerId: result.providerId,
              modelId: result.modelId,
              reasoningEffort: result.reasoningEffort,
            },
      );
      setCodexRunCollapsed(true);
      setCancellingCodexRun(false);
      setInspectorId(null);
      setHistoryOpen(false);
      setSettingsOpen(false);
      setNotice(
        `'${task.title}' 작업을 ${getAiProvider(selectedAiProvider).label}로 시작했습니다.`,
      );
      await loadProject(false);
    } catch (error) {
      if (currentOperation()) showError(error);
      throw error;
    } finally {
      if (starting.current === version) starting.current = null;
      if (currentOperation()) setPreparingTask(false);
    }
  };

  const cancelCodexRun = async () => {
    if (!codexRun || cancellingCodexRun) return;
    setCancellingCodexRun(true);
    try {
      await api.ai.cancelCodexRun(codexRun.runId);
      setNotice('AI 작업을 중지하고 있습니다.');
    } catch (error) {
      showError(error);
      setCancellingCodexRun(false);
    }
  };

  useEffect(() => {
    const event = collaboration.aiRun;
    const project = collaboration.projectId ?? workspace.root;
    if (!collaboration.connected) return;
    if (!event || !project || home) return;
    setCodexRun((current) =>
      current?.runId === event.runId && current.project === project
        ? {
            ...current,
            status: event.status,
            fileLock: event.fileLock,
            events:
              current.events.at(-1)?.timestamp === event.timestamp
                ? current.events
                : [...current.events, event].slice(-300),
          }
        : {
            project,
            runId: event.runId,
            taskPath: event.taskPath,
            status: event.status,
            fileLock: event.fileLock,
            events: [event],
            providerId: event.providerId ?? 'codex-cli',
            modelId: event.modelId ?? null,
            reasoningEffort: event.reasoningEffort,
          },
    );
  }, [
    collaboration.aiRun,
    collaboration.connected,
    collaboration.projectId,
    workspace.root,
    home,
  ]);

  return {
    preparingTask,
    setCodexStatus,
    setCodexRunCollapsed,
    codexRun,
    aiQueue,
    setAiQueue,
    codexStatus,
    checkingCodex,
    setCheckingCodex,
    setCodexRun,
    setCompletion,
    runPanelVisible,
    completionVisible,
    completion,
    closeCompletion,
    closeRunPanel,
    runFailure,
    runOutputPaths,
    codexRunCollapsed,
    cancellingCodexRun,
    refreshCodexStatus,
    runTaskWithCodex,
    cancelCodexRun,
    codexLogsRef,
  };
}
