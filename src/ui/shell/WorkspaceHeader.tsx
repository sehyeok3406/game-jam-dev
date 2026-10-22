import {
  Eye,
  EyeOff,
  History,
  Home,
  Moon,
  PanelLeft,
  Search,
  Settings2,
  Sparkles,
  Sun,
  Users,
} from 'lucide-react';
import appIcon from '../../../assets/icon.png';
import { isQueuePending, type AiQueueTask } from '../../ai-task-queue.ts';
import type {
  CollaborationState,
  HistoryEntry,
  WorkspaceState,
} from '../../shared.ts';
import { ROLE_NAMES } from '../CollaborationPanel';
import { MultiplayerLobby } from '../MultiplayerLobby';
import type { Theme } from '../workspace/workspace-types.ts';
interface Props {
  uiHidden: boolean;
  setUiHidden: import('react').Dispatch<
    import('react').SetStateAction<boolean>
  >;
  collaboration: CollaborationState;
  workspace: WorkspaceState;
  relevantEdits: { dirty: boolean; saving: boolean; failed: boolean }[];
  saveLabel: string;
  returnHome: () => Promise<void>;
  navigatorOpen: boolean;
  setNavigatorOpen: (value: import('react').SetStateAction<boolean>) => void;
  setCommandOpen: (value: import('react').SetStateAction<boolean>) => void;
  capabilities: Readonly<{
    localFiles: boolean;
    localAiExecution: boolean;
    selfHostManagement: boolean;
    appUpdates: boolean;
    nativeClipboard: boolean;
    multiplayer: boolean;
  }>;
  setCollaborationTab: import('react').Dispatch<
    import('react').SetStateAction<'create' | 'join' | 'recover'>
  >;
  setCollaborationOpen: (
    value: import('react').SetStateAction<boolean>,
  ) => void;
  canWriteAiRequest: boolean;
  locked: boolean;
  aiBusy: boolean;
  queueSupported: boolean;
  createTask: (
    kind?: 'organize' | 'implement' | 'both',
    htmlResult?: import('../../shared').HtmlResultChoice,
  ) => Promise<void>;
  aiDisabledReason:
    | ''
    | 'AI 실행은 CLI가 연결된 PC 앱에서 사용할 수 있습니다.'
    | '서버 업데이트 필요 (v0.8.0)'
    | '뷰어는 실행 불가'
    | '서버 연결 필요'
    | 'AI 작업 진행 중'
    | '프로젝트 편집 잠김';
  setApprovalInboxOpen: (
    value: import('react').SetStateAction<boolean>,
  ) => void;
  openHistory: (
    relative?: string | null,
    aiOnly?: boolean,
    entry?: HistoryEntry,
  ) => void;
  projectAiQueue: AiQueueTask[];
  settingsOpen: boolean;
  setSettingsOpen: (value: import('react').SetStateAction<boolean>) => void;
  toggleTheme: () => void;
  theme: Theme;
}
export function WorkspaceHeader({
  uiHidden,
  setUiHidden,
  collaboration,
  workspace,
  relevantEdits,
  saveLabel,
  returnHome,
  navigatorOpen,
  setNavigatorOpen,
  setCommandOpen,
  capabilities,
  setCollaborationTab,
  setCollaborationOpen,
  canWriteAiRequest,
  locked,
  aiBusy,
  queueSupported,
  createTask,
  aiDisabledReason,
  setApprovalInboxOpen,
  openHistory,
  projectAiQueue,
  settingsOpen,
  setSettingsOpen,
  toggleTheme,
  theme,
}: Props) {
  return (
    <>
      <button
        type="button"
        className={`ui-tools-toggle floating-surface icon-button${uiHidden ? ' ui-reveal-button' : ''}`}
        onClick={() => setUiHidden((value) => !value)}
        aria-pressed={!uiHidden}
        title={
          uiHidden
            ? '상단 메뉴·캔버스 탭 보이기 (Ctrl+\\)'
            : '상단 메뉴·캔버스 탭 숨기기 (Ctrl+\\)'
        }
      >
        {uiHidden ? <Eye size={16} /> : <EyeOff size={16} />}
      </button>
      {!uiHidden && (
        <header className="floating-header">
          <div className="header-project floating-surface">
            <img className="brand-mark" src={appIcon} alt="" />
            <div>
              <strong>
                {collaboration.projectName ?? workspace.name ?? 'Game Jam!'}
              </strong>
              <span
                className={`save-state${relevantEdits.some((edit) => edit.failed) || (collaboration.active && !collaboration.connected) ? ' save-state--warning' : ''}`}
                role="status"
              >
                {saveLabel}
              </span>
            </div>
            <button
              type="button"
              className="icon-button subtle-button"
              onClick={() => void returnHome()}
              title="프로젝트 홈으로 돌아가기"
            >
              <Home size={16} />
            </button>
            <span className="toolbar-divider" />

            <button
              className="icon-button"
              title="문서 목록 (L)"
              aria-pressed={navigatorOpen}
              onClick={() => setNavigatorOpen((value) => !value)}
            >
              <PanelLeft size={17} />
            </button>
            <button
              className="icon-button"
              title="검색 및 명령 (Ctrl+K)"
              onClick={() => setCommandOpen(true)}
            >
              <Search size={17} />
            </button>
          </div>

          <div className="header-actions floating-surface">
            {capabilities.multiplayer && collaboration.active && (
              <MultiplayerLobby
                key={collaboration.projectId}
                projectOnly
                discover
                project={collaboration}
              />
            )}
            <button
              type="button"
              className="collaboration-top-button"
              onClick={() => {
                setCollaborationTab('create');
                setCollaborationOpen(true);
              }}
              title={
                collaboration.active
                  ? `${collaboration.role ? ROLE_NAMES[collaboration.role] : '연결 중'} · 참여자·초대 관리`
                  : '초대 코드로 함께 작업하기'
              }
            >
              <Users size={15} />
              <span>
                {collaboration.active
                  ? `${collaboration.members.filter((member) => member.online).length}명 · ${collaboration.role ? ROLE_NAMES[collaboration.role] : '연결 중'}`
                  : '함께 작업'}
              </span>
              {collaboration.active && (
                <i
                  className={`member-dot ${collaboration.connected ? 'online' : ''}`}
                />
              )}
            </button>
            <span className="toolbar-divider" />
            <button
              type="button"
              className="header-ai-action header-ai-action--primary"
              aria-label="gamejam!"
              disabled={
                !canWriteAiRequest ||
                (collaboration.role !== 'editor' &&
                  (locked || (aiBusy && !queueSupported)))
              }
              onClick={() => void createTask()}
              title={
                aiDisabledReason ||
                `문서 정리 / HTML 구현 · 이전 요청 불러오기 (Ctrl+Enter)`
              }
            >
              <Sparkles size={15} /> <span>gamejam!</span>
            </button>
            {collaboration.active && (
              <button
                type="button"
                onClick={() => setApprovalInboxOpen(true)}
                title="팀원 구현 요청 확인"
              >
                {collaboration.role === 'admin' ? '요청함' : '내 요청'}
                {collaboration.pendingRequests
                  ? ` (${collaboration.pendingRequests})`
                  : ''}
              </button>
            )}
            <span className="toolbar-divider" />
            <button
              type="button"
              onClick={() => openHistory()}
              title="프로젝트 히스토리"
            >
              <History size={15} />
            </button>
            {(aiBusy || projectAiQueue.some(isQueuePending)) && (
              <span className="workspace-lock-label">
                AI 작업{' '}
                {projectAiQueue.filter(
                  (t) => isQueuePending(t) && t.status !== 'queued',
                ).length || (aiBusy ? 1 : 0)}{' '}
                · 예약{' '}
                {projectAiQueue.filter((t) => t.status === 'queued').length}
              </span>
            )}
            <button
              className="icon-button"
              title="설정 및 도구"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((value) => !value)}
            >
              <Settings2 size={17} />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={toggleTheme}
              title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </header>
      )}
    </>
  );
}
