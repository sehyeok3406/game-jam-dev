import type { ReactFlowInstance } from '@xyflow/react';
import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceAround,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalSpaceAround,
  ArrowRight,
  Frame,
  Hand,
  Info,
  Keyboard,
  Minimize2,
  MousePointer2,
  Plus,
  Puzzle,
  Redo2,
  StickyNote,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react';
import type {
  DrawingCommand,
  DrawingObject,
  DrawingStyle,
  DrawingTool,
} from '../../drawing-types.ts';
import type { PluginPanelPage } from '../../features/plugins/builtin-features.ts';
import type {
  CanvasDocument,
  CanvasSection,
  CanvasSheets,
  CollaborationState,
  WorkspaceState,
} from '../../shared.ts';
import type { ArrangementAction } from './selection-plan.ts';
import {
  DrawingInspector,
  DrawingToolButtons,
} from '../drawing/DrawingControls';
import type { CanvasTool } from '../workspace/workspace-types.ts';
import type { CanvasNode } from '../workspace/workspace-types.ts';
interface Props {
  undoState: { undo: string | null; redo: string | null };
  locked: boolean;
  editBusy: boolean;
  changeEdit: (direction: 'undo' | 'redo') => Promise<void>;
  flowRef: import('react').RefObject<ReactFlowInstance<CanvasNode> | null>;
  viewZoom: number;
  setShortcutsOpen: (value: import('react').SetStateAction<boolean>) => void;
  nodes: CanvasNode[];
  selectionLocked: boolean;
  canvasSheets: CanvasSheets;
  selectedDocuments: CanvasDocument[];
  selectedSections: CanvasSection[];
  selectedPreviews: import('./selection-plan').DeletionItem[];
  selectedDrawings: DrawingObject[];
  beginCanvasMove: (paths: string[], drawings?: DrawingObject[]) => void;
  inputSelection: CanvasDocument[];
  openKanbanControls: () => void;
  setInspectorId: import('react').Dispatch<
    import('react').SetStateAction<string | null>
  >;
  minimizeSelection: () => Promise<void>;
  duplicateSelection: () => Promise<void>;
  requestDelete: () => void;
  setSectionRename: (
    value: import('react').SetStateAction<
      import('./section-actions').SectionRenamePrompt | null
    >,
  ) => void;
  arrangementItems: import('./selection-plan').ArrangementItem[];
  arrangeSelection: (action: ArrangementAction) => Promise<void>;
  pluginPanelOpen: boolean;
  setPluginPanelPage: import('react').Dispatch<
    import('react').SetStateAction<PluginPanelPage>
  >;
  setPluginPanelOpen: (value: import('react').SetStateAction<boolean>) => void;
  tool: CanvasTool;
  drawingTool: DrawingTool;
  chooseDrawingTool: (next: DrawingTool) => void;
  workspace: WorkspaceState;
  collaboration: CollaborationState;
  setTool: import('react').Dispatch<import('react').SetStateAction<CanvasTool>>;
  setSectionTitle: (title: string) => void;
  setSectionDialogOpen: (open: boolean) => void;
  openImport: (position?: { x: number; y: number }) => void;
  importingFiles: boolean;
  drawing: {
    items: import('../../drawing-types').DrawingItem[];
    submit: (
      command: Omit<DrawingCommand, 'canvasId' | 'scope'> & {
        canvasId?: string;
      },
    ) => Promise<void>;
    flush: () => Promise<void>;
    reload: () => Promise<void>;
    partial: (object: DrawingObject | null) => void;
    error: string;
    recovery: DrawingCommand[] | null;
    recover: () => Promise<void>;
    discardRecovery: () => Promise<void>;
    retry: () => void;
    hold: () => Promise<void>;
    saving: boolean;
  };
  drawingStyle: DrawingStyle;
  setDrawingStyle: import('react').Dispatch<
    import('react').SetStateAction<DrawingStyle>
  >;
  submitDrawing: (command: Omit<DrawingCommand, 'canvasId' | 'scope'>) => void;
  duplicateDrawings: (objects?: DrawingObject[]) => void;
  deleteDrawings: () => void;
  drawingPressure: boolean;
  setDrawingPressure: import('react').Dispatch<
    import('react').SetStateAction<boolean>
  >;
  drawingTouch: boolean;
  setDrawingTouch: import('react').Dispatch<
    import('react').SetStateAction<boolean>
  >;
  drawingContinuous: boolean;
  setDrawingContinuous: import('react').Dispatch<
    import('react').SetStateAction<boolean>
  >;
  activeCanvas: string;
  gameUi: {
    frames: import('../../game-ui-types').GameUiFrame[];
    submit: (c: import('../../game-ui-types').GameUiCommand) => Promise<void>;
    error: string;
    retry: () => void;
    flush: () => Promise<void>;
    saving: boolean;
  };
  showError: (error: unknown) => void;
}
export function WorkspaceCanvasTools({
  undoState,
  locked,
  editBusy,
  changeEdit,
  flowRef,
  viewZoom,
  setShortcutsOpen,
  nodes,
  selectionLocked,
  canvasSheets,
  selectedDocuments,
  selectedSections,
  selectedPreviews,
  selectedDrawings,
  beginCanvasMove,
  inputSelection,
  openKanbanControls,
  setInspectorId,
  minimizeSelection,
  duplicateSelection,
  requestDelete,
  setSectionRename,
  arrangementItems,
  arrangeSelection,
  pluginPanelOpen,
  setPluginPanelPage,
  setPluginPanelOpen,
  tool,
  drawingTool,
  chooseDrawingTool,
  workspace,
  collaboration,
  setTool,
  setSectionTitle,
  setSectionDialogOpen,
  openImport,
  importingFiles,
  drawing,
  drawingStyle,
  setDrawingStyle,
  submitDrawing,
  duplicateDrawings,
  deleteDrawings,
  drawingPressure,
  setDrawingPressure,
  drawingTouch,
  setDrawingTouch,
  drawingContinuous,
  setDrawingContinuous,
  activeCanvas,
  gameUi,
  showError,
}: Props) {
  return (
    <>
      <div className="canvas-utility floating-surface">
        <button
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
        <span className="toolbar-divider" />
        <button
          title="캔버스 전체 보기 (Shift+1)"
          onClick={() =>
            void flowRef.current?.fitView({
              nodes: flowRef.current
                ?.getNodes()
                .filter((n) => !n.className?.includes('section-member-hidden')),
              padding: 0.16,
              duration: 250,
            })
          }
        >
          {Math.round(viewZoom * 100)}%
        </button>
        <button
          className="icon-button"
          title="단축키 안내 (?)"
          onClick={() => setShortcutsOpen(true)}
        >
          <Keyboard size={16} />
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
                  ? `그림 ${selectedDrawings.length}개 선택`
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
          data-plugin-launcher
          className={pluginPanelOpen ? 'active' : ''}
          aria-expanded={pluginPanelOpen}
          title="플러그인 관리"
          onClick={() => {
            setPluginPanelPage('plugins');
            setPluginPanelOpen(!pluginPanelOpen);
          }}
        >
          <Puzzle size={19} />
          <span>플러그인</span>
        </button>
        <span className="toolbar-divider toolbar-divider--vertical" />

        <DrawingToolButtons
          active={tool === 'drawing'}
          tool={drawingTool}
          onTool={chooseDrawingTool}
          disabled={
            locked ||
            !workspace.root ||
            (collaboration.active && collaboration.drawingsVersion !== 1)
          }
        />
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
        <span className="toolbar-divider toolbar-divider--vertical" />
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
      </nav>

      {(tool === 'drawing' || selectedDrawings.length > 0) && (
        <DrawingInspector
          objects={drawing.items.filter((o) =>
            selectedDrawings.some((s) => s.id === o.id),
          )}
          tool={drawingTool}
          style={drawingStyle}
          onStyle={setDrawingStyle}
          submit={submitDrawing}
          disabled={locked || drawing.saving}
          onDuplicate={() => duplicateDrawings()}
          allObjects={drawing.items}
          onDelete={deleteDrawings}
          pressure={drawingPressure}
          onPressure={setDrawingPressure}
          touch={drawingTouch}
          onTouch={setDrawingTouch}
          continuous={drawingContinuous}
          onContinuous={setDrawingContinuous}
          canvases={canvasSheets.canvases}
          canvasId={activeCanvas}
        />
      )}
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
    </>
  );
}
