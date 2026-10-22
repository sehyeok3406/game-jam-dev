import {
  ArrowRight,
  FolderOpen,
  Frame,
  History,
  Maximize2,
  Minimize2,
  Sparkles,
  StickyNote,
  Trash2,
  Ungroup,
  Upload,
} from 'lucide-react';
import { CARD_COLORS, cardColor } from '../../card-colors.ts';
import type { DrawingObject } from '../../drawing-types.ts';
import { drawingName } from '../../drawing-types.ts';
import { previewLabel } from '../../preview-output.ts';
import type {
  CanvasDocument,
  CanvasSection,
  CanvasSheets,
  CollaborationState,
  HistoryEntry,
  PreviewResult,
} from '../../shared.ts';
import { requireDesktopApi } from '../runtime/desktop-api.ts';
import {
  previewDeletionItem,
  type CanvasNode,
  type ContextMenuState,
  type DocumentContextMenuState,
  type PreviewContextMenuState,
  type SectionContextMenuState,
} from '../workspace/workspace-types.ts';
interface Props {
  previewContextMenu: PreviewContextMenuState | null;
  canvasSheets: CanvasSheets;
  locked: boolean;
  beginCanvasMove: (paths: string[], drawings?: DrawingObject[]) => void;
  pathLocked: (path: string) => boolean;
  editBusy: boolean;
  movingResults: boolean;
  setResultFolderPrompt: import('react').Dispatch<
    import('react').SetStateAction<PreviewResult | 'legacy' | null>
  >;
  setPreviewContextMenu: import('react').Dispatch<
    import('react').SetStateAction<PreviewContextMenuState | null>
  >;
  collaboration: CollaborationState;
  api: import('../../contracts/app-api.ts').AppApi;
  loadProject: (fit?: boolean, throwOnError?: boolean) => Promise<void>;
  showError: (error: unknown) => void;
  openHistory: (
    relative?: string | null,
    aiOnly?: boolean,
    entry?: HistoryEntry,
  ) => void;
  setDeletePrompt: (
    value: import('react').SetStateAction<
      import('./selection-plan').DeletionItem | null
    >,
  ) => void;
  documentContextMenu: DocumentContextMenuState | null;
  flushEditors: (finish?: boolean) => Promise<void>;
  setDocumentContextMenu: import('react').Dispatch<
    import('react').SetStateAction<DocumentContextMenuState | null>
  >;
  toggleDocumentCollapsed: (document: CanvasDocument) => Promise<void>;
  onBlocked: () => void;
  sectionContextMenu: SectionContextMenuState | null;
  toggleSection: (section: CanvasSection) => Promise<void>;
  setSectionContextMenu: import('react').Dispatch<
    import('react').SetStateAction<SectionContextMenuState | null>
  >;
  sectionCollapsed: (section: CanvasSection) => boolean;
  sectionLocked: (section: CanvasSection) => boolean;
  setSectionActionPrompt: (
    value: import('react').SetStateAction<
      import('./section-actions.ts').SectionActionPrompt | null
    >,
  ) => void;
  overlapMenu: { x: number; y: number; ids: string[] } | null;
  nodes: CanvasNode[];
  setNodes: import('react').Dispatch<
    import('react').SetStateAction<CanvasNode[]>
  >;
  setOverlapMenu: import('react').Dispatch<
    import('react').SetStateAction<{
      x: number;
      y: number;
      ids: string[];
    } | null>
  >;
  contextMenu: ContextMenuState | null;
  openImport: (position?: { x: number; y: number }) => void;
  setContextMenu: import('react').Dispatch<
    import('react').SetStateAction<ContextMenuState | null>
  >;
  addIdeaAt: (
    x: number,
    y: number,
    bounds?: import('../../note-placement').NoteBounds,
  ) => Promise<void>;
  selectedDocuments: CanvasDocument[];
  setSectionTitle: (title: string) => void;
  setSectionDialogOpen: (open: boolean) => void;
  hasTaskSelection: boolean;
  createTask: (
    kind?: 'organize' | 'implement' | 'both',
    htmlResult?: import('../../shared').HtmlResultChoice,
  ) => Promise<void>;
  selectedSections: CanvasSection[];
  capabilities: Readonly<{
    localFiles: boolean;
    localAiExecution: boolean;
    selfHostManagement: boolean;
    appUpdates: boolean;
    nativeClipboard: boolean;
    multiplayer: boolean;
  }>;
}
export function WorkspaceContextMenus({
  previewContextMenu,
  canvasSheets,
  locked,
  beginCanvasMove,
  pathLocked,
  editBusy,
  movingResults,
  setResultFolderPrompt,
  setPreviewContextMenu,
  collaboration,
  api,
  loadProject,
  showError,
  openHistory,
  setDeletePrompt,
  documentContextMenu,
  flushEditors,
  setDocumentContextMenu,
  toggleDocumentCollapsed,
  onBlocked,
  sectionContextMenu,
  toggleSection,
  setSectionContextMenu,
  sectionCollapsed,
  sectionLocked,
  setSectionActionPrompt,
  overlapMenu,
  nodes,
  setNodes,
  setOverlapMenu,
  contextMenu,
  openImport,
  setContextMenu,
  addIdeaAt,
  selectedDocuments,
  setSectionTitle,
  setSectionDialogOpen,
  hasTaskSelection,
  createTask,
  selectedSections,
  capabilities,
}: Props) {
  return (
    <>
      {previewContextMenu && (
        <div
          data-ui-id="preview-menu"
          className="canvas-context-menu document-context-menu floating-surface"
          style={{
            left: previewContextMenu.screenX,
            top: previewContextMenu.screenY,
          }}
          role="menu"
          aria-label="HTML 결과 메뉴"
        >
          <button
            type="button"
            role="menuitem"
            disabled={canvasSheets.canvases.length < 2 || locked}
            onClick={() =>
              beginCanvasMove([previewContextMenu.preview.relativePath])
            }
          >
            <ArrowRight size={16} />
            <span>
              <strong>다른 캔버스로 이동</strong>
              <small>파일 경로를 유지하며 이동</small>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={
              pathLocked(previewContextMenu.preview.relativePath) ||
              editBusy ||
              movingResults
            }
            onClick={() => {
              setResultFolderPrompt(previewContextMenu.preview);
              setPreviewContextMenu(null);
            }}
          >
            <FolderOpen size={16} />
            <span>
              <strong>폴더 분류·이동</strong>
              <small>시스템 · UI·UX · 콘텐츠 · 통합 시제품</small>
            </span>
          </button>
          <div
            className="card-color-picker"
            role="group"
            aria-label="HTML 창 배경색"
          >
            <span>배경색</span>
            {CARD_COLORS.map((color) => (
              <button
                key={color.id}
                title={color.label}
                aria-label={`${color.label} 배경색`}
                aria-pressed={
                  cardColor(previewContextMenu.preview.backgroundColor) ===
                  color.id
                }
                data-card-color={color.id}
                disabled={
                  pathLocked(previewContextMenu.preview.relativePath) ||
                  (collaboration.active &&
                    (!collaboration.connected ||
                      !!collaboration.pendingChanges))
                }
                onClick={() => {
                  void api.editor
                    .setDocumentColor({
                      relativePath: previewContextMenu.preview.relativePath,
                      color: color.id,
                    })
                    .then(() => {
                      setPreviewContextMenu(null);
                      return loadProject();
                    })
                    .catch(showError);
                }}
              />
            ))}
          </div>
          <div className="context-menu-title">
            {previewContextMenu.preview.title ||
              previewLabel(previewContextMenu.preview.relativePath)}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const relativePath = previewContextMenu.preview.relativePath;
              setPreviewContextMenu(null);
              void requireDesktopApi(api)
                .revealPath(relativePath)
                .catch(showError);
            }}
          >
            <FolderOpen size={16} />
            <span>
              <strong>파일 탐색기에서 열기</strong>
              <small>결과 폴더에서 HTML 파일 선택</small>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              openHistory(previewContextMenu.preview.relativePath);
              setPreviewContextMenu(null);
            }}
          >
            <History size={16} />
            <span>
              <strong>히스토리</strong>
              <small>이 결과의 이전 버전 확인</small>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger-menu-item"
            disabled={pathLocked(previewContextMenu.preview.relativePath)}
            onClick={() => {
              setDeletePrompt(previewDeletionItem(previewContextMenu.preview));
              setPreviewContextMenu(null);
            }}
          >
            <Trash2 size={16} />
            <span>
              <strong>삭제</strong>
              <small>결과 폴더와 관련 파일을 함께 휴지통으로 이동</small>
            </span>
          </button>
        </div>
      )}

      {documentContextMenu && (
        <div
          data-ui-id="document-menu"
          className="canvas-context-menu document-context-menu floating-surface"
          style={{
            left: documentContextMenu.screenX,
            top: documentContextMenu.screenY,
          }}
          role="menu"
        >
          <div className="context-menu-title">
            {documentContextMenu.document.title}
          </div>
          <button
            type="button"
            role="menuitem"
            disabled={canvasSheets.canvases.length < 2 || locked}
            onClick={() =>
              beginCanvasMove([documentContextMenu.document.relativePath])
            }
          >
            <ArrowRight size={16} />
            <span>
              <strong>다른 캔버스로 이동</strong>
              <small>파일 경로를 유지하며 이동</small>
            </span>
          </button>
          <div
            className="card-color-picker"
            role="group"
            aria-label="카드 배경색"
          >
            <span>배경색</span>
            {CARD_COLORS.map((color) => (
              <button
                key={color.id}
                title={color.label}
                aria-label={`${color.label} 배경색`}
                aria-pressed={
                  cardColor(documentContextMenu.document.backgroundColor) ===
                  color.id
                }
                data-card-color={color.id}
                disabled={pathLocked(documentContextMenu.document.relativePath)}
                onClick={() => {
                  void flushEditors()
                    .then(() =>
                      api.editor.setDocumentColor({
                        relativePath: documentContextMenu.document.relativePath,
                        revision: documentContextMenu.document.revision,
                        color: color.id,
                      }),
                    )
                    .then(() => {
                      setDocumentContextMenu(null);
                      return loadProject();
                    })
                    .catch(showError);
                }}
              />
            ))}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              openHistory(documentContextMenu.document.relativePath);
              setDocumentContextMenu(null);
            }}
          >
            <History size={16} />
            <span>
              <strong>히스토리</strong>
              <small>이전 내용 확인과 복원</small>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              void toggleDocumentCollapsed(documentContextMenu.document)
            }
          >
            {documentContextMenu.document.collapsed ? (
              <Maximize2 size={16} />
            ) : (
              <Minimize2 size={16} />
            )}
            <span>
              <strong>
                {documentContextMenu.document.collapsed ? '펼치기' : '최소화'}
              </strong>
              <small>
                {documentContextMenu.document.collapsed
                  ? '원래 카드 크기로 복원'
                  : '제목이 보이는 상단 바만 남기기'}
              </small>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger-menu-item"
            onClick={() => {
              if (pathLocked(documentContextMenu.document.relativePath)) {
                onBlocked();
                return;
              }
              setDeletePrompt(documentContextMenu.document);
              setDocumentContextMenu(null);
            }}
          >
            <Trash2 size={16} />
            <span>
              <strong>삭제</strong>
              <small>확인 후 Windows 휴지통으로 이동</small>
            </span>
          </button>
        </div>
      )}

      {sectionContextMenu && (
        <div
          data-ui-id="section-menu"
          className="canvas-context-menu document-context-menu floating-surface"
          style={{
            left: sectionContextMenu.screenX,
            top: sectionContextMenu.screenY,
          }}
          role="menu"
        >
          <div className="context-menu-title">
            {sectionContextMenu.section.title}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void toggleSection(sectionContextMenu.section);
              setSectionContextMenu(null);
            }}
          >
            {sectionCollapsed(sectionContextMenu.section)
              ? '섹션 펼치기'
              : '섹션 최소화'}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={canvasSheets.canvases.length < 2 || locked}
            onClick={() =>
              beginCanvasMove([sectionContextMenu.section.relativePath])
            }
          >
            <ArrowRight size={16} />
            <span>
              <strong>다른 캔버스로 이동</strong>
              <small>파일 경로를 유지하며 이동</small>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={sectionLocked(sectionContextMenu.section)}
            onClick={() => {
              setSectionActionPrompt({
                section: sectionContextMenu.section,
                deleteMembers: false,
              });
              setSectionContextMenu(null);
            }}
          >
            <Ungroup size={16} />
            <span>
              <strong>섹션 해제</strong>
              <small>
                파일 {sectionContextMenu.section.members.length}개는 그대로 유지
              </small>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger-menu-item"
            disabled={sectionLocked(sectionContextMenu.section)}
            onClick={() => {
              setSectionActionPrompt({
                section: sectionContextMenu.section,
                deleteMembers: true,
              });
              setSectionContextMenu(null);
            }}
          >
            <Trash2 size={16} />
            <span>
              <strong>섹션과 파일 삭제</strong>
              <small>
                안의 파일 {sectionContextMenu.section.members.length}개도 함께
                삭제
              </small>
            </span>
          </button>
        </div>
      )}

      {overlapMenu && (
        <div
          className="canvas-context-menu drawing-overlap-menu floating-surface"
          role="menu"
          aria-label="겹친 항목 선택"
          style={{
            left: overlapMenu.x,
            top: overlapMenu.y,
            maxHeight: 300,
            overflow: 'auto',
          }}
        >
          <div className="context-menu-title">겹친 항목 선택</div>
          {overlapMenu.ids.map((id) => {
            const n = nodes.find((n) => n.id === id);
            if (!n) return null;
            const label =
              n.data.kind === 'drawing'
                ? drawingName(n.data.object)
                : n.data.kind === 'document'
                  ? n.data.document.title
                  : n.data.kind === 'section'
                    ? n.data.section.title
                    : n.data.kind === 'kanban'
                      ? '칸반 보드'
                      : n.data.kind === 'game-ui'
                        ? n.data.frame.title
                        : (n.data.preview.title ?? 'HTML 결과');
            return (
              <button
                key={id}
                role="menuitem"
                onClick={() => {
                  setNodes((current) =>
                    current.map((n) => ({ ...n, selected: n.id === id })),
                  );
                  setOverlapMenu(null);
                }}
              >
                {label}
                <small>{id.slice(-8)}</small>
              </button>
            );
          })}
        </div>
      )}
      {contextMenu && (
        <div
          data-ui-id="canvas-menu"
          className="canvas-context-menu floating-surface"
          style={{ left: contextMenu.screenX, top: contextMenu.screenY }}
          role="menu"
        >
          <div className="context-menu-title">이 위치에 만들기</div>
          <button
            type="button"
            role="menuitem"
            disabled={locked}
            onClick={() => {
              openImport({ x: contextMenu.flowX, y: contextMenu.flowY });
              setContextMenu(null);
            }}
          >
            <Upload size={16} />
            <span>
              <strong>파일 불러오기</strong>
              <small>MD 참고 문서 · 이미지 에셋 / 도식</small>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void addIdeaAt(contextMenu.flowX, contextMenu.flowY);
              setContextMenu(null);
            }}
          >
            <StickyNote size={16} />
            <span>
              <strong>새 메모 파일</strong>
              <small>Markdown 아이디어 카드</small>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={selectedDocuments.length === 0}
            onClick={() => {
              setContextMenu(null);
              setSectionTitle('새 섹션');
              setSectionDialogOpen(true);
            }}
          >
            <Frame size={16} />
            <span>
              <strong>선택 파일로 섹션 만들기</strong>
              <small>{selectedDocuments.length}개 파일을 실제로 묶기</small>
            </span>
          </button>
          <div className="context-menu-divider" />
          <button
            type="button"
            role="menuitem"
            disabled={!hasTaskSelection}
            onClick={() => {
              void createTask();
              setContextMenu(null);
            }}
          >
            <Sparkles size={16} />
            <span>
              <strong>gamejam!</strong>
              <small>
                파일 {selectedDocuments.length}개 · 섹션{' '}
                {selectedSections.length}개 선택됨
              </small>
            </span>
          </button>
          <div className="context-menu-divider" />
          <button
            type="button"
            role="menuitem"
            disabled={!capabilities.localFiles}
            title={
              !capabilities.localFiles
                ? '프로젝트 폴더 열기는 PC 앱에서 사용할 수 있습니다.'
                : undefined
            }
            onClick={() => {
              void requireDesktopApi(api).openWorkspace();
              setContextMenu(null);
            }}
          >
            <FolderOpen size={16} />
            <span>
              <strong>프로젝트 폴더 열기</strong>
              <small>파일 탐색기에서 보기</small>
            </span>
          </button>
        </div>
      )}
    </>
  );
}
