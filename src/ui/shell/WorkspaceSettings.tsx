import { Bot, FolderOpen, Frame, Keyboard, RefreshCw, X } from 'lucide-react';
import type { CodexConnectionStatus, PreviewResult } from '../../shared.ts';
import { requireDesktopApi } from '../runtime/desktop-api.ts';
import { ProjectLayoutControl } from './ProjectLayoutControl.tsx';
interface Props {
  prepareLayout?: () => Promise<void>;
  settingsOpen: boolean;
  setSettingsOpen: (value: import('react').SetStateAction<boolean>) => void;
  workflowEditable: boolean;
  workflowBusy: boolean;
  setStatusManagerOpen: (
    value: import('react').SetStateAction<boolean>,
  ) => void;
  statusError: string;
  setCodexStatusOpen: (value: import('react').SetStateAction<boolean>) => void;
  codexStatus: CodexConnectionStatus | null;
  capabilities: Readonly<{
    localFiles: boolean;
    localAiExecution: boolean;
    selfHostManagement: boolean;
    appUpdates: boolean;
    nativeClipboard: boolean;
    multiplayer: boolean;
  }>;
  setUpdateOpen: (value: import('react').SetStateAction<boolean>) => void;
  loadProject: (fit?: boolean, throwOnError?: boolean) => Promise<void>;
  api: import('../../contracts/app-api.ts').AppApi;
  locked: boolean;
  editBusy: boolean;
  movingResults: boolean;
  setResultFolderPrompt: import('react').Dispatch<
    import('react').SetStateAction<PreviewResult | 'legacy' | null>
  >;
  snapEnabled: boolean;
  setSnapEnabled: import('react').Dispatch<
    import('react').SetStateAction<boolean>
  >;
  setShortcutsOpen: (value: import('react').SetStateAction<boolean>) => void;
}
export function WorkspaceSettings({
  prepareLayout,
  settingsOpen,
  setSettingsOpen,
  workflowEditable,
  workflowBusy,
  setStatusManagerOpen,
  statusError,
  setCodexStatusOpen,
  codexStatus,
  capabilities,
  setUpdateOpen,
  loadProject,
  api,
  locked,
  editBusy,
  movingResults,
  setResultFolderPrompt,
  snapEnabled,
  setSnapEnabled,
  setShortcutsOpen,
}: Props) {
  return (
    <>
      {settingsOpen && (
        <aside
          className="canvas-settings floating-surface"
          aria-label="캔버스 설정"
        >
          <header>
            <strong>설정 및 도구</strong>
            <button
              className="icon-button"
              title="설정 닫기"
              onClick={() => setSettingsOpen(false)}
            >
              <X size={16} />
            </button>
          </header>
          <button
            disabled={!workflowEditable || workflowBusy}
            onClick={() => {
              setSettingsOpen(false);
              setStatusManagerOpen(true);
            }}
          >
            상태 속성 옵션 관리
          </button>
          {statusError && (
            <p className="workflow-error" role="alert">
              {statusError}
            </p>
          )}
          <button
            onClick={() => {
              setSettingsOpen(false);
              setCodexStatusOpen(true);
            }}
          >
            <Bot size={16} /> AI 연결 설정{' '}
            <small>
              {codexStatus?.available && codexStatus.authenticated
                ? '연결됨'
                : '연결 필요'}
            </small>
          </button>
          <button
            disabled={!capabilities.appUpdates}
            title={
              !capabilities.appUpdates
                ? '앱 업데이트는 PC 앱에서 사용할 수 있습니다.'
                : undefined
            }
            onClick={() => {
              setSettingsOpen(false);
              setUpdateOpen(true);
            }}
          >
            <RefreshCw size={16} /> 앱 업데이트
          </button>
          <button onClick={() => void loadProject(false)}>
            <RefreshCw size={16} /> 캔버스 새로고침
          </button>
          <button
            disabled={!capabilities.localFiles}
            title={
              !capabilities.localFiles
                ? '프로젝트 폴더 열기는 PC 앱에서 사용할 수 있습니다.'
                : undefined
            }
            onClick={() => void requireDesktopApi(api).openWorkspace()}
          >
            <FolderOpen size={16} /> 프로젝트 폴더 열기
          </button>
          <ProjectLayoutControl
            api={api}
            prepare={prepareLayout}
            disabled={locked || editBusy || movingResults}
            refresh={() => loadProject(false, true)}
          />
          <button
            disabled={locked || editBusy || movingResults}
            onClick={() => {
              setSettingsOpen(false);
              setResultFolderPrompt('legacy');
            }}
          >
            <FolderOpen size={16} /> 기존 결과물 폴더 정리
          </button>
          <button
            aria-pressed={snapEnabled}
            onClick={() => setSnapEnabled((value) => !value)}
          >
            <Frame size={16} /> 스마트 정렬 가이드{' '}
            <small>{snapEnabled ? '켜짐' : '꺼짐'}</small>
          </button>
          <button
            onClick={() => {
              setSettingsOpen(false);
              setShortcutsOpen(true);
            }}
          >
            <Keyboard size={16} /> 단축키 안내 <kbd>?</kbd>
          </button>
        </aside>
      )}
    </>
  );
}
