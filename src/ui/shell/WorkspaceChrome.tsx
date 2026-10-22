import type { ComponentProps } from 'react';
import { WorkspaceHeader } from '../shell/WorkspaceHeader';
import { WorkspaceCanvasTools } from '../canvas/WorkspaceCanvasTools';
import { WorkspaceAiPanels } from '../ai/WorkspaceAiPanels';
import { WorkspaceSettings } from '../shell/WorkspaceSettings';
import { WorkspaceCanvas } from '../canvas/WorkspaceCanvas';
import { WorkspaceInspector } from '../shell/WorkspaceInspector';
import { Puzzle } from 'lucide-react';
import { ArrowRight } from 'lucide-react';
import { DrawingToolButtons } from '../drawing/DrawingControls';
import appIcon from '../../../assets/icon.png';
import { MultiplayerLobby } from '../MultiplayerLobby';
import { isQueuePending } from '../../ai-task-queue';
import {
  Map as MapIcon,
  Maximize,
  ZoomIn,
  ZoomOut,
  MoreHorizontal,
  Clock3,
} from 'lucide-react';
import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceAround,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalSpaceAround,
  Search,
  Home,
  PanelLeft,
  Settings2,
  Keyboard,
  Undo2,
  Redo2,
  Upload,
  Info,
  Eye,
  EyeOff,
  Frame,
  Hand,
  History,
  Minimize2,
  Moon,
  MousePointer2,
  Plus,
  Sparkles,
  StickyNote,
  Type,
  Sun,
  Trash2,
  Users,
} from 'lucide-react';

type Props = Pick<
  ComponentProps<typeof WorkspaceHeader>,
  | 'aiBusy'
  | 'aiDisabledReason'
  | 'canWriteAiRequest'
  | 'collaboration'
  | 'createTask'
  | 'locked'
  | 'navigatorOpen'
  | 'openHistory'
  | 'projectAiQueue'
  | 'queueSupported'
  | 'relevantEdits'
  | 'returnHome'
  | 'saveLabel'
  | 'setCommandOpen'
  | 'setNavigatorOpen'
  | 'setSettingsOpen'
  | 'setUiHidden'
  | 'theme'
  | 'toggleTheme'
  | 'uiHidden'
  | 'workspace'
> &
  Pick<
    ComponentProps<typeof WorkspaceCanvasTools>,
    | 'arrangeSelection'
    | 'arrangementItems'
    | 'beginCanvasMove'
    | 'canvasSheets'
    | 'changeEdit'
    | 'chooseDrawingTool'
    | 'drawing'
    | 'drawingTool'
    | 'duplicateSelection'
    | 'gameUi'
    | 'importingFiles'
    | 'inputSelection'
    | 'minimizeSelection'
    | 'openImport'
    | 'openKanbanControls'
    | 'requestDelete'
    | 'selectedDocuments'
    | 'selectedDrawings'
    | 'selectedPreviews'
    | 'selectedSections'
    | 'selectionLocked'
    | 'setPluginPanelOpen'
    | 'setPluginPanelPage'
    | 'setSectionDialogOpen'
    | 'setSectionTitle'
    | 'setTool'
    | 'tool'
    | 'undoState'
    | 'viewZoom'
  > &
  Pick<
    ComponentProps<typeof WorkspaceAiPanels>,
    'completion' | 'flowRef' | 'nodes' | 'setCodexRunCollapsed' | 'showError'
  > &
  Pick<
    ComponentProps<typeof WorkspaceSettings>,
    'editBusy' | 'setShortcutsOpen'
  > &
  Pick<ComponentProps<typeof WorkspaceCanvas>, 'preview'> &
  Pick<
    ComponentProps<typeof WorkspaceInspector>,
    'setInspectorId' | 'setSectionRename'
  > & {
    compactChrome: boolean;
    dockPanel: import('../CanvasChrome').CanvasPanelId | null;
    eraserMode: import('../../drawing-types').EraserMode;
    eraserSize: number;
    hasTaskSelection: boolean;
    minimapVisible: boolean;
    notice: string;
    noticeVisible: boolean;
    partialEraseSupported: boolean;
    setDockPanel: import('react').Dispatch<
      import('react').SetStateAction<
        import('../CanvasChrome').CanvasPanelId | null
      >
    >;
    setEraserSettings: (value: {
      mode: import('../../drawing-types').EraserMode;
      size: number;
    }) => void;
    setMinimapVisible: import('react').Dispatch<
      import('react').SetStateAction<boolean>
    >;
  };

export function WorkspaceChrome({
  aiBusy,
  aiDisabledReason,
  arrangeSelection,
  arrangementItems,
  beginCanvasMove,
  canWriteAiRequest,
  canvasSheets,
  changeEdit,
  chooseDrawingTool,
  collaboration,
  compactChrome,
  completion,
  createTask,
  dockPanel,
  drawing,
  drawingTool,
  duplicateSelection,
  editBusy,
  eraserMode,
  eraserSize,
  flowRef,
  gameUi,
  hasTaskSelection,
  importingFiles,
  inputSelection,
  locked,
  minimapVisible,
  minimizeSelection,
  navigatorOpen,
  nodes,
  notice,
  noticeVisible,
  openHistory,
  openImport,
  openKanbanControls,
  partialEraseSupported,
  preview,
  projectAiQueue,
  queueSupported,
  relevantEdits,
  requestDelete,
  returnHome,
  saveLabel,
  selectedDocuments,
  selectedDrawings,
  selectedPreviews,
  selectedSections,
  selectionLocked,
  setCodexRunCollapsed,
  setCommandOpen,
  setDockPanel,
  setEraserSettings,
  setInspectorId,
  setMinimapVisible,
  setNavigatorOpen,
  setPluginPanelOpen,
  setPluginPanelPage,
  setSectionDialogOpen,
  setSectionRename,
  setSectionTitle,
  setSettingsOpen,
  setShortcutsOpen,
  setTool,
  setUiHidden,
  showError,
  theme,
  toggleTheme,
  tool,
  uiHidden,
  undoState,
  viewZoom,
  workspace,
}: Props) {
  return (
    <>
      <button
        type="button"
        className={`ui-tools-toggle floating-surface icon-button${uiHidden ? ' ui-reveal-button' : ''}`}
        onClick={() => setUiHidden((value) => !value)}
        aria-pressed={!uiHidden}
        title={uiHidden ? '집중 모드 종료 (Ctrl+\\)' : '집중 모드 (Ctrl+\\)'}
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

          <div className="header-undo" aria-label="편집 기록">
            <button
              aria-label="실행 취소"
              className="icon-button"
              title={
                undoState.undo
                  ? `실행 취소 · ${undoState.undo} (Ctrl+Z)`
                  : '되돌릴 작업 없음'
              }
              disabled={!undoState.undo || locked || editBusy}
              onClick={() => void changeEdit('undo')}
            >
              <Undo2 size={16} />
            </button>
            <button
              aria-label="다시 실행"
              className="icon-button"
              title={
                undoState.redo
                  ? `다시 실행 · ${undoState.redo} (Ctrl+Shift+Z)`
                  : '다시 실행할 작업 없음'
              }
              disabled={!undoState.redo || locked || editBusy}
              onClick={() => void changeEdit('redo')}
            >
              <Redo2 size={16} />
            </button>
          </div>
          <div className="header-actions floating-surface">
            {collaboration.active && (
              <MultiplayerLobby
                key={collaboration.projectId}
                projectOnly
                discover
                discoveryOnly
                project={collaboration}
              />
            )}
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
            <button
              className="canvas-ai-summary"
              aria-label="AI 작업 패널"
              aria-expanded={dockPanel === 'ai'}
              onClick={() => {
                setDockPanel(dockPanel === 'ai' ? null : 'ai');
                setCodexRunCollapsed(false);
              }}
            >
              <Clock3 size={16} /> AI 작업
              {aiBusy || projectAiQueue.some(isQueuePending) ? (
                <span>
                  실행{' '}
                  {projectAiQueue.filter(
                    (t) => isQueuePending(t) && t.status !== 'queued',
                  ).length || (aiBusy ? 1 : 0)}{' '}
                  · 예약{' '}
                  {projectAiQueue.filter((t) => t.status === 'queued').length}
                </span>
              ) : completion ? (
                <span>
                  {completion.status === 'failed' ? '실패 · 확인 필요' : '완료'}
                </span>
              ) : null}
            </button>
            <button
              className="collaboration-top-button"
              aria-label="협업 패널"
              aria-expanded={dockPanel === 'collaboration'}
              onClick={() =>
                setDockPanel(
                  dockPanel === 'collaboration' ? null : 'collaboration',
                )
              }
            >
              <Users size={16} />
              <span>
                협업
                {collaboration.active
                  ? ' · ' + collaboration.members.filter((m) => m.online).length
                  : ''}
                {collaboration.pendingRequests
                  ? ' (' + collaboration.pendingRequests + ')'
                  : ''}
              </span>
              {collaboration.active && (
                <i
                  className={
                    'member-dot ' + (collaboration.connected ? 'online' : '')
                  }
                />
              )}
            </button>
            <button
              className="icon-button"
              aria-label="속성 패널"
              title="속성"
              onClick={() =>
                setDockPanel(dockPanel === 'properties' ? null : 'properties')
              }
            >
              <Settings2 size={17} />
            </button>
            <details className="canvas-main-menu">
              <summary aria-label="더보기">
                <MoreHorizontal size={19} />
              </summary>
              <div role="menu">
                <button
                  role="menuitem"
                  onClick={(e) => {
                    e.currentTarget.closest('details')?.removeAttribute('open');
                    openHistory();
                  }}
                >
                  <History size={16} /> 프로젝트 히스토리
                </button>
                <button
                  role="menuitem"
                  data-plugin-launcher
                  onClick={(e) => {
                    e.currentTarget.closest('details')?.removeAttribute('open');
                    setPluginPanelPage('plugins');
                    setPluginPanelOpen(true);
                  }}
                >
                  <Puzzle size={16} /> 플러그인
                </button>
                <button
                  role="menuitem"
                  onClick={(e) => {
                    e.currentTarget.closest('details')?.removeAttribute('open');
                    setSettingsOpen(true);
                  }}
                >
                  <Settings2 size={16} /> 설정 및 도구
                </button>
                <button role="menuitem" onClick={toggleTheme}>
                  {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}{' '}
                  {theme === 'dark' ? '라이트 모드' : '다크 모드'}
                </button>
                <button role="menuitem" onClick={() => setShortcutsOpen(true)}>
                  <Keyboard size={16} /> 단축키 안내
                </button>
              </div>
            </details>
          </div>
        </header>
      )}
      <div className="canvas-utility floating-surface" aria-label="화면 조작">
        <button
          className="icon-button"
          aria-label="미니맵 전환"
          aria-pressed={
            compactChrome ? dockPanel === 'navigation' : minimapVisible
          }
          onClick={() => {
            if (compactChrome)
              setDockPanel(dockPanel === 'navigation' ? null : 'navigation');
            else setMinimapVisible((v) => !v);
          }}
        >
          <MapIcon size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="축소"
          onClick={() => void flowRef.current?.zoomOut()}
        >
          <ZoomOut size={16} />
        </button>
        <details className="canvas-zoom-menu">
          <summary aria-label="확대율 메뉴">
            {Math.round(viewZoom * 100)}%
          </summary>
          <div>
            <button onClick={() => void flowRef.current?.zoomTo(1)}>
              100%로 보기
            </button>
            <button
              onClick={() => {
                const selected = flowRef.current
                  ?.getNodes()
                  .filter((n) => n.selected);
                if (selected?.length)
                  void flowRef.current?.fitView({
                    nodes: selected,
                    padding: 0.2,
                  });
              }}
            >
              선택 항목 맞춤
            </button>
          </div>
        </details>
        <button
          className="icon-button"
          aria-label="확대"
          onClick={() => void flowRef.current?.zoomIn()}
        >
          <ZoomIn size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="캔버스 전체 맞춤"
          title="캔버스 전체 보기 (Shift+1)"
          onClick={() =>
            void flowRef.current?.fitView({
              nodes: flowRef.current
                .getNodes()
                .filter((n) => !n.className?.includes('section-member-hidden')),
              padding: 0.16,
              duration: 250,
            })
          }
        >
          <Maximize size={16} />
        </button>
      </div>
      {nodes.some((node) => node.selected) && (
        <nav
          className="selection-context floating-surface"
          aria-label="선택 항목 도구"
        >
          <button
            title="선택 항목을 다른 캔버스로 이동"
            disabled={
              selectionLocked ||
              canvasSheets.canvases.length < 2 ||
              (!selectedDocuments.length &&
                !selectedSections.length &&
                !selectedPreviews.length &&
                !selectedDrawings.length)
            }
            onClick={() =>
              beginCanvasMove(
                nodes
                  .filter((node) => node.selected)
                  .map((node) =>
                    node.data.kind === 'document'
                      ? node.data.document.relativePath
                      : node.data.kind === 'section'
                        ? node.data.section.relativePath
                        : node.data.kind === 'preview'
                          ? node.data.preview.relativePath
                          : '',
                  ),
                selectedDrawings,
              )
            }
          >
            <ArrowRight size={14} />
          </button>
          <span>
            {selectedSections.length
              ? `섹션 ${selectedSections.length}개 · 실제 문서 ${inputSelection.length}개`
              : selectedDocuments.length
                ? `문서 ${selectedDocuments.length}개 선택`
                : selectedDrawings.length
                  ? `${selectedDrawings.every((o) => o.kind === 'text') ? '텍스트' : '그림'} ${selectedDrawings.length}개 선택`
                  : nodes.some(
                        (node) => node.selected && node.data.kind === 'kanban',
                      )
                    ? '칸반 보드 선택'
                    : 'HTML 결과 선택'}
          </span>
          <button
            title="선택 항목 상세 정보"
            onClick={() => {
              const node = nodes.find((node) => node.selected)!;
              if (node.data.kind === 'kanban') openKanbanControls();
              else setInspectorId(node.id);
            }}
          >
            <Info size={14} />
          </button>
          <button
            title="선택 항목 최소화 또는 펼치기 (Ctrl+Shift+M)"
            disabled={selectionLocked}
            onClick={() => void minimizeSelection()}
          >
            <Minimize2 size={14} />
          </button>
          {selectedDocuments.length > 0 && (
            <>
              <button
                disabled={locked}
                title="선택 파일 복제 (Ctrl+D)"
                onClick={() => void duplicateSelection()}
              >
                <Plus size={14} />
              </button>
            </>
          )}
          {(selectedDocuments.length > 0 || selectedPreviews.length > 0) && (
            <button
              disabled={selectionLocked}
              title="선택 파일·HTML 결과 삭제 (Delete)"
              onClick={requestDelete}
            >
              <Trash2 size={14} />
            </button>
          )}
          {selectedSections.length === 1 && !selectedDocuments.length && (
            <button
              disabled={locked}
              onClick={() =>
                setSectionRename({
                  section: selectedSections[0],
                  title: selectedSections[0].title,
                })
              }
            >
              이름 변경
            </button>
          )}
          {arrangementItems.length >= 2 && (
            <details
              className="selection-arrange-menu"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.removeAttribute('open');
                  event.currentTarget.querySelector('summary')?.focus();
                }
              }}
            >
              <summary>
                <AlignHorizontalJustifyCenter size={15} /> 정렬·간격
              </summary>
              <div role="group" aria-label="선택 항목 정렬 및 간격">
                {(
                  [
                    ['left', '왼쪽 맞춤', AlignHorizontalJustifyStart],
                    [
                      'center-x',
                      '가로 가운데 맞춤',
                      AlignHorizontalJustifyCenter,
                    ],
                    ['right', '오른쪽 맞춤', AlignHorizontalJustifyEnd],
                    ['top', '위쪽 맞춤', AlignVerticalJustifyStart],
                    [
                      'center-y',
                      '세로 가운데 맞춤',
                      AlignVerticalJustifyCenter,
                    ],
                    ['bottom', '아래쪽 맞춤', AlignVerticalJustifyEnd],
                    [
                      'distribute-x',
                      '가로 간격 동일하게',
                      AlignHorizontalSpaceAround,
                    ],
                    [
                      'distribute-y',
                      '세로 간격 동일하게',
                      AlignVerticalSpaceAround,
                    ],
                  ] as const
                ).map(([action, label, Icon]) => (
                  <button
                    key={action}
                    aria-label={label}
                    disabled={
                      selectionLocked ||
                      (action.startsWith('distribute') &&
                        arrangementItems.length < 3)
                    }
                    title={
                      action.startsWith('distribute')
                        ? `${label} (3개 이상)`
                        : label
                    }
                    onClick={(event) => {
                      event.currentTarget
                        .closest('details')
                        ?.removeAttribute('open');
                      void arrangeSelection(action);
                    }}
                  >
                    <Icon size={16} />
                    {label}
                  </button>
                ))}
              </div>
            </details>
          )}
        </nav>
      )}
      <nav className="bottom-toolbar floating-surface" aria-label="캔버스 도구">
        <button
          type="button"
          className={tool === 'select' ? 'active' : ''}
          aria-pressed={tool === 'select'}
          onClick={() => setTool('select')}
          title="선택 도구 (V)"
        >
          <MousePointer2 size={19} />
          <span>선택</span>
          <kbd>V</kbd>
        </button>
        <button
          type="button"
          className={tool === 'hand' ? 'active' : ''}
          aria-pressed={tool === 'hand'}
          onClick={() => setTool('hand')}
          title="이동 도구 (H)"
        >
          <Hand size={19} />
          <span>이동</span>
          <kbd>H</kbd>
        </button>
        <button
          type="button"
          className={tool === 'note' ? 'active' : ''}
          aria-pressed={tool === 'note'}
          disabled={locked}
          onClick={() => setTool('note')}
          title="새 메모 (N) — 빈 곳 클릭 또는 원하는 크기로 드래그"
        >
          <StickyNote size={19} />
          <span>새 메모</span>
          <kbd>N</kbd>
        </button>
        <button
          type="button"
          className={tool === 'text' ? 'active' : ''}
          aria-pressed={tool === 'text'}
          disabled={
            locked ||
            !workspace.root ||
            (collaboration.active && collaboration.drawingTextVersion !== 1)
          }
          onClick={() => setTool('text')}
          title="텍스트 (T) — 빈 곳을 클릭해서 입력"
        >
          <Type size={19} />
          <span>텍스트</span>
          <kbd>T</kbd>
        </button>
        <DrawingToolButtons
          eraserMode={eraserMode}
          eraserSize={eraserSize}
          onEraser={(mode, size) => setEraserSettings({ mode, size })}
          partialSupported={
            partialEraseSupported &&
            !(
              preview?.id === 'drawing-eraser' &&
              preview.state === 'unsupported'
            )
          }
          grouped
          active={tool === 'drawing'}
          tool={drawingTool}
          onTool={(t) => {
            chooseDrawingTool(t);
          }}
          disabled={
            locked ||
            !workspace.root ||
            (collaboration.active && collaboration.drawingsVersion !== 1)
          }
        />
        <details className="canvas-tool-more">
          <summary aria-label="추가 편집 도구">
            <MoreHorizontal size={19} />
            <span>더보기</span>
          </summary>
          <div>
            <button
              type="button"
              disabled={selectedDocuments.length === 0 || selectionLocked}
              onClick={() => {
                setSectionTitle('새 섹션');
                setSectionDialogOpen(true);
              }}
              title="선택한 파일을 하나의 섹션으로 묶기 (Shift+S / Ctrl+G)"
            >
              <Frame size={19} />
              <span>섹션</span>
              <kbd>⇧S</kbd>
            </button>
            <button
              type="button"
              onClick={() => openImport()}
              disabled={locked || importingFiles}
              title="Markdown · HTML 게임 · 이미지 파일 불러오기 (Ctrl+I)"
            >
              <Upload size={19} />
              <span>불러오기</span>
              <kbd>Ctrl I</kbd>
            </button>
            <button
              data-plugin-launcher
              onClick={() => {
                setPluginPanelPage('plugins');
                setPluginPanelOpen(true);
              }}
            >
              <Puzzle size={19} />
              <span>플러그인</span>
            </button>
          </div>
        </details>
      </nav>
      {(gameUi.error || gameUi.saving) && (
        <aside className="drawing-save-alert floating-surface" role="status">
          {gameUi.error || '게임 UI 저장 중…'}
          {gameUi.error && (
            <button onClick={gameUi.retry}>게임 UI 저장 재시도</button>
          )}
        </aside>
      )}
      {(drawing.error || drawing.recovery || drawing.saving) && (
        <aside className="drawing-save-alert floating-surface" role="status">
          {drawing.error ||
            (drawing.recovery
              ? '이전에 저장하지 못한 그림 초안이 있습니다.'
              : '그림 저장 중…')}
          {drawing.recovery ? (
            <>
              <button onClick={() => void drawing.recover().catch(showError)}>
                초안 복구
              </button>
              <button
                onClick={() => void drawing.discardRecovery().catch(showError)}
              >
                초안 버리기
              </button>
            </>
          ) : drawing.error ? (
            <>
              <button onClick={drawing.retry}>저장 재시도</button>
              <button onClick={() => void drawing.hold().catch(showError)}>
                초안으로 보류
              </button>
            </>
          ) : null}
        </aside>
      )}
      <div
        className="status-toast floating-surface"
        hidden={!noticeVisible && !hasTaskSelection}
        role="status"
      >
        <span className="status-dot" />
        <span>{notice}</span>
        {hasTaskSelection && (
          <strong>
            파일 {selectedDocuments.length} · 섹션 {selectedSections.length}
          </strong>
        )}
      </div>
    </>
  );
}
