import {
  Background,
  Controls,
  MiniMap,
  NodeResizer,
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
  useNodesState,
} from '@xyflow/react';
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
  PanelLeft,
  Settings2,
  Keyboard,
  Undo2,
  Redo2,
  Columns2,
  FileText,
  Upload,
  Info,
  Link2,
  AlertCircle,
  Bot,
  CheckCircle2,
  Code2,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  Frame,
  Hand,
  History,
  LoaderCircle,
  Monitor,
  Expand,
  Shrink,
  Maximize2,
  Minimize2,
  Moon,
  MousePointer2,
  Plus,
  Play,
  RefreshCw,
  Sparkles,
  Square,
  StickyNote,
  Sun,
  Trash2,
  Users,
  Ungroup,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { MarkdownEditor } from './MarkdownEditor';
import { AI_PROVIDERS } from '../ai-providers';
import { DocumentMarkdown } from './DocumentMarkdown';
import { setMarkdownTaskChecked } from '../markdown-editing';
import {
  PREVIEW_PRESETS,
  normalizePreviewWindow,
  previewPreset,
  previewViewport,
  selectPreviewPreset,
  fitPreviewViewport,
  withPreviewKeyboardBridge,
} from '../preview-window';
import { previewLabel } from '../preview-output';
import { PREVIEW_SANDBOX } from '../preview-permissions';
import { gamejamTaskInput, type GamejamRequest } from '../gamejam-request';
import { documentSets } from '../document-output';
import { resultName, MAX_RESULT_NAME } from '../result-name';
import { CollaborationPanel, ROLE_NAMES } from './CollaborationPanel';
import {
  CanvasNavigator,
  CommandPalette,
  ShortcutDialog,
  CompareDialog,
  type CanvasItem,
  type CanvasCommand,
} from './CanvasOverlays';
import { canvasShortcut, snapPosition } from '../canvas-ux';
import { drainEditorDraft, editorDraftMatches } from '../editor-ux';
import { resolveAssetLink } from '../asset-links';
import { authorLabel } from '../author-label';
import {
  entryTaskRecord,
  historyTaskPath,
  isAiTaskPath,
  isCanvasDocument,
  relatedAiEntries,
} from '../ai-task-records';
import { AiTaskDetails } from './AiTaskDetails';
import { UpdatePanel } from './UpdatePanel';
import {
  DEFAULT_TASK_INSTRUCTIONS,
  defaultTaskInstructions,
  MAX_TASK_INSTRUCTIONS,
} from '../task-instructions';
import type {
  AiProviderId,
  CanvasDocument,
  CanvasSection,
  CodexConnectionStatus,
  CodexRunEvent,
  PreviewResult,
  PreviewWindowState,
  HistoryEntry,
  HtmlResultChoice,
  WorkspaceState,
  CollaborationState,
  FileAuthorship,
} from '../shared';

type CanvasTool = 'select' | 'hand' | 'note';
type Theme = 'dark' | 'light';

type ContextMenuState = {
  screenX: number;
  screenY: number;
  flowX: number;
  flowY: number;
};

type DocumentContextMenuState = {
  screenX: number;
  screenY: number;
  document: CanvasDocument;
};

type SectionContextMenuState = {
  screenX: number;
  screenY: number;
  section: CanvasSection;
};

type PreviewContextMenuState = {
  screenX: number;
  screenY: number;
  preview: PreviewResult;
};

type SectionActionPrompt = {
  section: CanvasSection;
  deleteMembers: boolean;
};

type MembershipPrompt = {
  document: CanvasDocument;
  fromSection: CanvasSection | null;
  toSection: CanvasSection | null;
  x: number;
  y: number;
  width: number;
  height: number;
};

type ArrangementAction =
  | 'left'
  | 'center-x'
  | 'right'
  | 'top'
  | 'center-y'
  | 'bottom'
  | 'distribute-x'
  | 'distribute-y';

type ArrangementItem = {
  revision?: number;
  key: string;
  kind: 'document' | 'section';
  relativePath: string;
  x: number;
  y: number;
  width: number;
  height: number;
  storedHeight: number;
};

type CodexRunView = {
  runId: string;
  taskPath: string;
  status: CodexRunEvent['status'];
  events: CodexRunEvent[];
  providerId: AiProviderId;
  modelId: string | null;
};

const getAiProvider = (providerId: AiProviderId) =>
  AI_PROVIDERS.find((provider) => provider.id === providerId) ??
  AI_PROVIDERS[0];

const getAiModelLabel = (providerId: AiProviderId, modelId: string | null) =>
  getAiProvider(providerId).models.find((model) => model.id === (modelId ?? ''))
    ?.label ??
  modelId ??
  '자동 선택';

const CODEX_STATUS_LABELS: Record<CodexRunEvent['status'], string> = {
  validating: '결과 확인 중',
  starting: '시작 중',
  running: '실행 중',
  completed: '완료',
  failed: '실패',
  cancelled: '취소됨',
};

type DocumentNodeData = {
  kind: 'document';
  locked: boolean;
  onBlocked: () => void;
  registerEditor: (id: string, flush: (() => Promise<void>) | null) => void;
  document: CanvasDocument;
  collaborative: boolean;
  draftKey: string;
  editingBy?: string;
  beginEdit: (document: CanvasDocument) => Promise<void>;
  endEdit: (document: CanvasDocument) => Promise<void>;
  onSave: (
    document: CanvasDocument,
    title: string,
    body: string,
  ) => Promise<void>;
  onResize: (
    document: CanvasDocument,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => Promise<void>;
  onSource: (id: string) => void;
  onCopyTask: (document: CanvasDocument) => Promise<void>;
  onReveal: (document: CanvasDocument) => Promise<void>;
  onDetails: () => void;
  onCollapse: () => void;
  sourceTitles: Record<string, string>;
  reportEdit: (
    id: string,
    state: { dirty: boolean; saving: boolean; failed: boolean },
  ) => void;
};

type PreviewNodeData = {
  kind: 'preview';
  preview: PreviewResult;
  windowState: PreviewWindowState;
  busy: boolean;
  onWindowChange: (state: PreviewWindowState) => Promise<void>;
  onHistory: () => void;
  onCompare: () => void;
};

type SectionNodeData = {
  kind: 'section';
  locked: boolean;
  section: CanvasSection;
  onResize: (
    section: CanvasSection,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => Promise<void>;
  onReveal: (section: CanvasSection) => Promise<void>;
};

type DocumentCanvasNode = Node<DocumentNodeData, 'document'>;
type PreviewCanvasNode = Node<PreviewNodeData, 'preview'>;
type SectionCanvasNode = Node<SectionNodeData, 'section'>;
type CanvasNode = DocumentCanvasNode | PreviewCanvasNode | SectionCanvasNode;

function sameIds(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

const sectionNodeId = (id: string) => `section:${id}`;
const previewNodeId = (relative: string) => `preview:${relative}`;

const TYPE_LABELS: Record<CanvasDocument['type'], string> = {
  reference: '참고 문서',
  image: '이미지',
  idea: '아이디어',
  system: '정리 문서',
  overview: '개요',
  question: '미정 사항',
  'ai-task': 'AI 작업',
};
const statusLabel = (status: string) =>
  (
    ({
      raw: '메모',
      draft: '초안',
      pending: '대기',
      running: '실행 중',
      starting: '준비 중',
      validating: '검증 중',
      completed: '완료',
      failed: '실패',
      cancelled: '중지',
      active: '사용 중',
    }) as Record<string, string>
  )[status] ?? status;

function ProjectImage({
  path,
  title,
  cacheKey,
}: {
  path: string;
  title: string;
  cacheKey: string;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    setContent(null);
    setError('');
    window.gameCanvas
      .readAsset(path)
      .then((data) => {
        if (!disposed) setContent(data);
      })
      .catch(() => {
        if (!disposed)
          setError(
            '이미지를 찾을 수 없습니다. 연결 상태와 원본 파일을 확인해주세요.',
          );
      });
    return () => {
      disposed = true;
    };
  }, [path, cacheKey]);
  if (!content)
    return (
      <span className="project-image-placeholder">
        {error || '이미지 불러오는 중…'}
      </span>
    );
  return (
    <img
      className="project-image"
      src={content}
      alt={title}
      draggable={false}
      onError={() => {
        setContent(null);
        setError('이미지를 표시할 수 없습니다.');
      }}
    />
  );
}

function DocumentCard({ data, selected }: NodeProps<DocumentCanvasNode>) {
  const { document } = data;
  const cardRef = useRef<HTMLElement>(null);
  const savingRef = useRef<Promise<void> | null>(null);
  const taskBusy = useRef(false);
  const [taskError, setTaskError] = useState('');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(document.title);
  const [body, setBody] = useState(document.body);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [startingEdit, setStartingEdit] = useState(false);
  const [editFocus, setEditFocus] = useState<{
    title: boolean;
    point?: { x: number; y: number };
  }>({ title: false });
  const editorOwner = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const latestRef = useRef({ title, body });
  latestRef.current = { title, body };
  const savedRef = useRef({ title: document.title, body: document.body });
  const [cachedDraft, setCachedDraft] = useState<{
    title: string;
    body: string;
  } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(data.draftKey);
      const draft = raw ? JSON.parse(raw) : null;
      setCachedDraft(
        typeof draft?.title === 'string' && typeof draft?.body === 'string'
          ? draft
          : null,
      );
    } catch {
      setCachedDraft(null);
    }
  }, [data.draftKey]);

  useEffect(() => {
    if (!editing) {
      setTitle(document.title);
      setBody(document.body);
      savedRef.current = { title: document.title, body: document.body };
    }
  }, [document.body, document.title, editing]);

  const persist = useCallback(
    async (finish: boolean) => {
      // Serialize the entire save, not just IPC. Finishing drains edits typed
      // during a pending write before releasing the collaboration lock.
      while (savingRef.current) await savingRef.current.catch(() => undefined);
      const operation = (async () => {
        setSaving(true);
        setSaveFailed(false);
        try {
          await drainEditorDraft(
            () => latestRef.current,
            () => savedRef.current,
            async (current) => {
              const latestData = dataRef.current;
              // React may not have committed the last refresh yet. Read the
              // adapter's acknowledged revision, and never rebase silently onto
              // someone else's text (including externally edited local files).
              const stored = (await window.gameCanvas.listDocuments()).find(
                (item) =>
                  item.relativePath === latestData.document.relativePath,
              );
              if (!stored)
                throw new Error(
                  '문서를 찾을 수 없습니다. 초안을 보관한 뒤 프로젝트를 확인해주세요.',
                );
              if (editorDraftMatches(stored, current)) {
                savedRef.current = current;
                return;
              }
              if (!editorDraftMatches(stored, savedRef.current))
                throw new Error(
                  '문서가 다른 곳에서 변경되었습니다. 초안은 유지되며, 최신 내용을 확인한 뒤 다시 편집해주세요.',
                );
              await latestData.onSave(stored, current.title, current.body);
              savedRef.current = current;
            },
            finish,
          );
          if (
            latestRef.current.title === savedRef.current.title &&
            latestRef.current.body === savedRef.current.body
          ) {
            try {
              localStorage.removeItem(dataRef.current.draftKey);
            } catch {
              /* Optional draft cache. */
            }
            setCachedDraft(null);
          }
          if (finish) {
            await dataRef.current.endEdit(dataRef.current.document);
            setEditing(false);
          }
        } catch (error) {
          setSaveFailed(true);
          throw error;
        } finally {
          setSaving(false);
        }
      })();
      savingRef.current = operation;
      try {
        await operation;
      } finally {
        if (savingRef.current === operation) savingRef.current = null;
      }
    },
    [data, document],
  );
  const save = useCallback(() => persist(true), [persist]);
  const dirty =
    editing &&
    (title !== savedRef.current.title || body !== savedRef.current.body);
  useEffect(() => {
    data.reportEdit(document.id, { dirty, saving, failed: saveFailed });
  }, [data.reportEdit, document.id, dirty, saving, saveFailed]);
  const toggleTask = async (offset: number, checked: boolean) => {
    if (taskBusy.current || startingEdit || editing) return;
    if (data.locked) {
      data.onBlocked();
      return;
    }
    taskBusy.current = true;
    setSaving(true);
    setTaskError('');
    let acquired = false;
    try {
      await data.beginEdit(document);
      acquired = true;
      const current = (await window.gameCanvas.listDocuments()).find(
        (item) => item.relativePath === document.relativePath,
      );
      if (!current || current.body !== document.body)
        throw new Error(
          '문서가 변경되었습니다. 다시 표시된 체크리스트에서 눌러주세요.',
        );
      const next = setMarkdownTaskChecked(current.body, offset, checked);
      await data.onSave(current, current.title, next);
    } catch (error) {
      setTaskError(
        error instanceof Error
          ? error.message
          : '체크리스트를 저장하지 못했습니다. 다시 시도해주세요.',
      );
    } finally {
      if (acquired) {
        try {
          await data.endEdit(document);
        } catch {
          setTaskError(
            '체크리스트 편집 잠금을 해제하지 못했습니다. 연결 상태를 확인해주세요.',
          );
        }
      }
      taskBusy.current = false;
      setSaving(false);
    }
  };
  useEffect(() => {
    if (
      !editing ||
      (title === savedRef.current.title && body === savedRef.current.body)
    )
      return;
    try {
      localStorage.setItem(data.draftKey, JSON.stringify({ title, body }));
    } catch {
      /* Browser storage quota must not prevent server autosave. */
    }
    if (data.locked || saveFailed) return;
    const timer = setTimeout(
      () => void persist(false).catch(() => undefined),
      800,
    );
    return () => clearTimeout(timer);
  }, [
    editing,
    title,
    body,
    data.draftKey,
    data.collaborative,
    data.locked,
    saveFailed,
    persist,
  ]);

  const startEdit = async (focus: typeof editFocus = { title: false }) => {
    if (startingEdit || taskBusy.current) return;
    if (data.locked) {
      data.onBlocked();
      return;
    }
    setStartingEdit(true);
    try {
      await data.beginEdit(document);
      setEditFocus(focus);
      setEditing(true);
    } catch {
      /* parent displays the lock/connection error */
    } finally {
      setStartingEdit(false);
    }
  };

  useEffect(() => {
    if (editing && editFocus.title) titleRef.current?.focus();
  }, [editing, editFocus.title]);

  useEffect(() => {
    data.registerEditor(document.id, editing ? save : null);
    return () => data.registerEditor(document.id, null);
  }, [data.registerEditor, document.id, editing, save]);

  useEffect(() => {
    if (!editing) return;
    const finishEditingOutside = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target
          .closest('[data-editor-owner]')
          ?.getAttribute('data-editor-owner') === editorOwner
      )
        return;
      if (
        target instanceof Element &&
        target.closest('.react-flow__node') ===
          cardRef.current?.closest('.react-flow__node')
      )
        return;
      if (target instanceof Node && !cardRef.current?.contains(target)) {
        void save().catch(() => undefined);
      }
    };
    window.addEventListener('pointerdown', finishEditingOutside, true);
    return () =>
      window.removeEventListener('pointerdown', finishEditingOutside, true);
  }, [editing, save, editorOwner]);

  const editStatus = data.locked
    ? '편집 잠김 · 초안은 유지됩니다'
    : saveFailed
      ? '저장 실패 · 초안 보관됨'
      : saving
        ? '저장 중…'
        : dirty
          ? '자동 저장 대기…'
          : '저장됨';

  return (
    <>
      {!document.collapsed && (
        <NodeResizer
          color="var(--selection)"
          isVisible={selected && !data.locked}
          lineClassName="window-resize-edge"
          handleClassName="window-resize-handle"
          minWidth={260}
          minHeight={180}
          onResizeEnd={(_event, params) => {
            void data.onResize(
              document,
              params.x,
              params.y,
              params.width,
              params.height,
            );
          }}
        />
      )}
      <article
        ref={cardRef}
        className={`document-card document-card--${document.type}${document.collapsed ? ' document-card--collapsed' : ''}`}
      >
        <header className="document-card__header">
          <span className="document-type">{TYPE_LABELS[document.type]}</span>
          {document.collapsed && (
            <strong className="document-card__collapsed-title">
              {document.title}
            </strong>
          )}
          <span
            className={`document-status document-status--${document.status}`}
          >
            {statusLabel(document.status)}
          </span>
          <div className="document-header-actions nodrag">
            <button
              className="icon-button"
              title={document.collapsed ? '메모 펼치기' : '메모 최소화'}
              onClick={data.onCollapse}
            >
              {document.collapsed ? (
                <Maximize2 size={13} />
              ) : (
                <Minimize2 size={13} />
              )}
            </button>
            <button
              className="icon-button"
              title="문서 상세 정보"
              onClick={data.onDetails}
            >
              <Info size={13} />
            </button>
          </div>
        </header>
        {data.editingBy && (
          <div className="document-editing-badge">
            {data.editingBy}님 편집 중
          </div>
        )}

        {!document.collapsed && (
          <>
            {editing ? (
              <div
                className="document-editor nodrag nowheel"
                onKeyDown={(event) => {
                  if (
                    event.nativeEvent.isComposing ||
                    event.isPropagationStopped()
                  )
                    return;
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    event.preventDefault();
                    void save().catch(() => undefined);
                  }
                  if (
                    (event.ctrlKey || event.metaKey) &&
                    ['Enter', 's'].includes(event.key)
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    void save().catch(() => undefined);
                  }
                }}
              >
                <input
                  ref={titleRef}
                  aria-label="문서 제목"
                  value={title}
                  readOnly={data.locked}
                  onChange={(event) => {
                    latestRef.current = {
                      ...latestRef.current,
                      title: event.target.value,
                    };
                    setTitle(event.target.value);
                  }}
                />
                <MarkdownEditor
                  value={body}
                  locked={data.locked}
                  owner={editorOwner}
                  title={title}
                  onTitle={(next) => {
                    latestRef.current = { ...latestRef.current, title: next };
                    setTitle(next);
                  }}
                  status={editStatus}
                  onFinish={() => void save().catch(() => undefined)}
                  initialFocus={editFocus}
                  onChange={(next) => {
                    latestRef.current = { ...latestRef.current, body: next };
                    setBody(next);
                  }}
                />
                <div className="document-editor__actions">
                  <span
                    role="status"
                    title="Ctrl+S · Ctrl+Enter로 저장하고 편집 종료"
                  >
                    {editStatus}
                  </span>
                  {cachedDraft && (
                    <button
                      type="button"
                      onClick={() => {
                        setTitle(cachedDraft.title);
                        setBody(cachedDraft.body);
                        latestRef.current = {
                          title: cachedDraft.title,
                          body: cachedDraft.body,
                        };
                        setCachedDraft(null);
                      }}
                    >
                      보관된 초안 불러오기
                    </button>
                  )}
                  <button
                    type="button"
                    className="button-primary"
                    onClick={() => void save().catch(() => undefined)}
                    disabled={saving}
                  >
                    {saving ? '저장 중' : saveFailed ? '다시 저장' : '완료'}
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="document-card__content nodrag"
                onClick={(event) => {
                  if (event.shiftKey || event.ctrlKey || event.metaKey) return;
                  if (
                    event.target instanceof Element &&
                    event.target.closest('button, a, input')
                  )
                    return;
                  if (document.type === 'image') return;
                  if (data.locked) data.onBlocked();
                  else
                    void startEdit({
                      title: !!(
                        event.target instanceof Element &&
                        event.target.closest('.document-card__title')
                      ),
                      point: { x: event.clientX, y: event.clientY },
                    });
                }}
                title={
                  document.type === 'image'
                    ? '이미지 참고 자료 · 설명 편집 버튼으로 수정'
                    : '클릭해서 바로 편집'
                }
              >
                <h2 className="document-card__title">{document.title}</h2>
                {document.asset && (
                  <div className="image-card-preview nowheel">
                    <ProjectImage
                      path={document.asset.path}
                      title={document.title}
                      cacheKey={`${data.draftKey}:${document.assetVersion ?? 0}`}
                    />
                    <span>
                      {document.asset.purpose === 'asset'
                        ? '게임 에셋'
                        : '설명 도식'}{' '}
                      · {document.asset.originalName} ·{' '}
                      {(document.asset.bytes / 1024).toFixed(1)} KB
                    </span>
                    <div className="image-card-actions">
                      <button
                        disabled={data.locked}
                        onClick={() => void startEdit()}
                      >
                        설명 편집
                      </button>
                      <button
                        onClick={() =>
                          void window.gameCanvas.copyText(document.asset!.path)
                        }
                      >
                        에셋 경로 복사
                      </button>
                      <button
                        onClick={() =>
                          void window.gameCanvas.revealPath(
                            document.asset!.path,
                          )
                        }
                      >
                        원본 파일 보기
                      </button>
                    </div>
                  </div>
                )}
                {taskError && (
                  <p className="markdown-editor-warning" role="alert">
                    {taskError}
                  </p>
                )}
                <div className="markdown-body nowheel">
                  <DocumentMarkdown
                    body={document.body}
                    disabled={
                      data.locked || saving || startingEdit || !!data.editingBy
                    }
                    onToggle={(offset, checked) =>
                      void toggleTask(offset, checked)
                    }
                    image={({ src, alt }) => {
                      const path = resolveAssetLink(src, document.relativePath);
                      if (path && path === document.asset?.path) return null;
                      return path ? (
                        <ProjectImage
                          path={path}
                          title={alt ?? ''}
                          cacheKey={`${data.draftKey}:${document.modifiedAt}`}
                        />
                      ) : (
                        <span className="project-image-placeholder">
                          {alt || '이미지'} · 연결된 이미지 파일을 별도로
                          불러와주세요.
                        </span>
                      );
                    }}
                  />
                </div>
                {document.type !== 'image' && (
                  <div className="edit-hint">
                    {startingEdit
                      ? '편집 권한 확인 중…'
                      : cachedDraft
                        ? '보관된 초안 있음 · 클릭하여 편집'
                        : '클릭하여 편집'}
                  </div>
                )}
              </div>
            )}

            {document.sources.length > 0 && (
              <details className="source-list nodrag">
                <summary>
                  <Link2 size={12} /> 참고 메모 {document.sources.length}개
                </summary>
                {document.sources.map((source) => (
                  <button
                    type="button"
                    key={`${document.id}-${source.id}`}
                    onClick={() => data.onSource(source.id)}
                    title={source.contribution}
                  >
                    {data.sourceTitles[source.id] ?? source.id}
                  </button>
                ))}
              </details>
            )}

            <div className="card-actions nodrag">
              {document.type === 'ai-task' && (
                <button
                  type="button"
                  onClick={() => void data.onCopyTask(document)}
                >
                  <Bot size={13} /> 작업 복사
                </button>
              )}
              <button type="button" onClick={data.onDetails}>
                <Info size={13} /> 상세 정보
              </button>
            </div>
          </>
        )}
      </article>
    </>
  );
}

function SectionCard({ data, selected }: NodeProps<SectionCanvasNode>) {
  const { section } = data;
  return (
    <section className="section-card">
      <NodeResizer
        color="var(--selection)"
        isVisible={selected && !data.locked}
        lineClassName="window-resize-edge"
        handleClassName="window-resize-handle"
        minWidth={420}
        minHeight={280}
        onResizeEnd={(_event, params) => {
          void data.onResize(
            section,
            params.x,
            params.y,
            params.width,
            params.height,
          );
        }}
      />
      <header className="section-card__header">
        <div className="section-card__title">
          <Frame size={15} />
          <strong>{section.title}</strong>
          <span>{section.members.length}개 파일</span>
        </div>
        <div className="section-card__file">
          <code>{section.relativePath}</code>
          <button
            type="button"
            className="nodrag"
            onClick={() => void data.onReveal(section)}
            title="섹션 Markdown 파일 보기"
          >
            <Folder size={13} />
          </button>
        </div>
      </header>
      <div className="section-card__empty-hint">
        섹션을 선택하면 내부 파일 전체를 AI 작업 범위로 사용할 수 있습니다.
      </div>
    </section>
  );
}

function PreviewCard({ data, selected }: NodeProps<PreviewCanvasNode>) {
  const [restart, setRestart] = useState(0);
  const cardRef = useRef<HTMLElement>(null);
  const playAreaRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsId = useId();
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const [playAreaSize, setPlayAreaSize] = useState({ width: 1, height: 1 });
  const [settingsPosition, setSettingsPosition] = useState({ left: 0, top: 0 });
  const state = data.windowState;
  const preset = previewPreset(state);
  const viewport = previewViewport(state);
  const previewHtml = useMemo(
    () => withPreviewKeyboardBridge(data.preview.content, settingsId),
    [data.preview.content, settingsId],
  );
  const collapsed = state.collapsed && !fullscreen;
  useEffect(() => {
    const update = () => {
      const active = document.fullscreenElement === cardRef.current;
      cardRef.current
        ?.querySelector('iframe')
        ?.contentWindow?.postMessage(
          { type: 'game-canvas:preview-fullscreen', id: settingsId, active },
          '*',
        );
      setFullscreen(active);
    };
    document.addEventListener('fullscreenchange', update);
    const exit = () => {
      if (document.fullscreenElement === cardRef.current)
        void document.exitFullscreen().catch(() => {});
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') exit();
    };
    const frameEscape = (event: MessageEvent) => {
      if (
        event.source ===
          cardRef.current?.querySelector('iframe')?.contentWindow &&
        event.data?.type === 'game-canvas:preview-escape' &&
        event.data?.id === settingsId
      )
        exit();
    };
    window.addEventListener('keydown', escape, true);
    window.addEventListener('message', frameEscape);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('message', frameEscape);
    };
  }, [settingsId]);
  useEffect(() => {
    if (fullscreen) cardRef.current?.querySelector('iframe')?.focus();
  }, [fullscreen]);
  useEffect(() => {
    const area = playAreaRef.current;
    if (!area) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const width = area.clientWidth,
          height = area.clientHeight;
        setPlayAreaSize((previous) =>
          previous.width === width && previous.height === height
            ? previous
            : { width, height },
        );
      });
    });
    observer.observe(area);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  const toggleFullscreen = async () => {
    if (settingsRef.current?.matches(':popover-open'))
      settingsRef.current.hidePopover();
    setFullscreenError(null);
    try {
      if (document.fullscreenElement === cardRef.current)
        await document.exitFullscreen();
      else await cardRef.current?.requestFullscreen();
    } catch {
      setFullscreenError(
        '전체화면을 시작할 수 없습니다. 창이 활성화된 상태에서 다시 눌러주세요.',
      );
    }
  };
  return (
    <>
      {!preset && !collapsed && !fullscreen && (
        <NodeResizer
          color="var(--selection)"
          isVisible={selected && !state.collapsed}
          lineClassName="window-resize-edge"
          handleClassName="window-resize-handle"
          minWidth={420}
          minHeight={300}
          onResizeEnd={(_event, params) =>
            void data.onWindowChange({ ...state, ...params })
          }
        />
      )}
      <section
        ref={cardRef}
        className={`preview-card${collapsed ? ' preview-card--collapsed' : ''}${state.width < 560 && !fullscreen ? ' preview-card--compact' : ''}`}
      >
        <header className={fullscreen ? 'nodrag' : 'preview-drag-handle'}>
          <strong title={data.preview.relativePath}>
            <span className="preview-dot" /> HTML 실행 ·{' '}
            {data.preview.title ?? previewLabel(data.preview.relativePath)}
          </strong>
          <span className="preview-card__status">
            {data.busy
              ? 'AI 작업 중 · 이전 결과'
              : fullscreen
                ? '전체화면 · 클릭해 마우스 시점'
                : '실행 가능한 결과'}
          </span>
          <div className="preview-card__actions nodrag">
            <button
              type="button"
              className="icon-button"
              aria-label="HTML 화면 비율 설정"
              title={`화면 비율 · ${viewport.width} × ${viewport.height} · ${viewport.ratio}${fullscreen ? ' (전체화면 종료 후 변경)' : ''}`}
              disabled={fullscreen}
              popoverTarget={settingsId}
              onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                setSettingsPosition({
                  left: Math.max(
                    8,
                    Math.min(window.innerWidth - 328, bounds.right - 320),
                  ),
                  top: Math.max(
                    8,
                    Math.min(window.innerHeight - 224, bounds.bottom + 8),
                  ),
                });
              }}
            >
              <Monitor size={14} />
            </button>
            <button
              type="button"
              className="icon-button"
              title={
                fullscreen ? 'HTML 전체화면 종료 (Esc)' : 'HTML 전체화면 플레이'
              }
              onClick={() => void toggleFullscreen()}
            >
              {fullscreen ? <Shrink size={14} /> : <Expand size={14} />}
            </button>
            <button
              type="button"
              className="icon-button"
              title="HTML 다시 실행"
              onClick={() => setRestart((value) => value + 1)}
            >
              <RefreshCw size={14} />
            </button>
            <button
              type="button"
              className="icon-button"
              title="HTML 히스토리"
              disabled={fullscreen}
              onClick={data.onHistory}
            >
              <History size={14} />
            </button>
            <button
              className="icon-button"
              title="HTML 버전 비교"
              disabled={fullscreen}
              onClick={data.onCompare}
            >
              <Columns2 size={14} />
            </button>
            <button
              type="button"
              className="icon-button"
              title={state.collapsed ? 'HTML 창 펼치기' : 'HTML 창 최소화'}
              disabled={fullscreen}
              onClick={() =>
                void data.onWindowChange({
                  ...state,
                  collapsed: !state.collapsed,
                })
              }
            >
              {state.collapsed ? (
                <Maximize2 size={14} />
              ) : (
                <Minimize2 size={14} />
              )}
            </button>
          </div>
        </header>
        <div
          ref={settingsRef}
          id={settingsId}
          popover="auto"
          className="preview-settings nodrag nowheel"
          style={settingsPosition}
        >
          <strong>HTML 화면 비율</strong>
          <p>고정 해상도를 고르면 크기 조절이 잠깁니다.</p>
          <select
            aria-label="HTML 화면 비율"
            value={preset?.id ?? 'free'}
            onChange={(event) =>
              void data.onWindowChange(
                selectPreviewPreset(state, event.target.value),
              )
            }
          >
            <option value="free">자유 비율</option>
            {[...new Set(PREVIEW_PRESETS.map((option) => option.device))].map(
              (device) => (
                <optgroup key={device} label={device}>
                  {PREVIEW_PRESETS.filter(
                    (option) => option.device === device,
                  ).map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.device} · {option.ratio} · {option.width} ×{' '}
                      {option.height}
                    </option>
                  ))}
                </optgroup>
              ),
            )}
          </select>
          <span
            className="preview-card__viewport-size"
            title={`HTML 화면 ${viewport.width} × ${viewport.height}px · ${viewport.ratio} · ${preset ? '크기 조절 잠김' : '크기 조절 가능'}`}
          >
            {viewport.width} × {viewport.height} · {viewport.ratio}
            <small>{preset ? '크기 잠김' : '자유 조절'}</small>
          </span>
          <button
            type="button"
            popoverTarget={settingsId}
            popoverTargetAction="hide"
          >
            완료
          </button>
        </div>
        {!collapsed && data.preview.warnings?.length ? (
          <div
            className="preview-import-warning nodrag nowheel"
            role="status"
            title={data.preview.warnings.join('\n')}
          >
            외부 파일 참조 있음 · 단일 HTML만 불러왔으므로 일부 기능이 동작하지
            않을 수 있어요.
          </div>
        ) : null}
        <div
          ref={playAreaRef}
          className="preview-card__play-area"
          style={{ display: collapsed ? 'none' : undefined }}
        >
          <div
            className={`preview-card__viewport${fullscreen && preset ? ' preview-card__viewport--scaled' : ''}`}
            style={
              fullscreen && preset
                ? {
                    width: viewport.width,
                    height: viewport.height,
                    transform: `translate(-50%, -50%) scale(${fitPreviewViewport(viewport.width, viewport.height, playAreaSize.width, playAreaSize.height)})`,
                  }
                : undefined
            }
          >
            <iframe
              key={restart}
              className="nodrag nowheel"
              title="생성된 HTML 게임 미리보기"
              sandbox={PREVIEW_SANDBOX}
              onLoad={(event) =>
                event.currentTarget.contentWindow?.postMessage(
                  {
                    type: 'game-canvas:preview-fullscreen',
                    id: settingsId,
                    active: document.fullscreenElement === cardRef.current,
                  },
                  '*',
                )
              }
              srcDoc={previewHtml}
            />
          </div>
        </div>
        {fullscreenError && (
          <div role="alert" className="preview-card__error">
            {fullscreenError}
          </div>
        )}
      </section>
    </>
  );
}

const nodeTypes: NodeTypes = {
  document: DocumentCard,
  preview: PreviewCard,
  section: SectionCard,
};

function WorkspaceCanvas() {
  const [collaboration, setCollaboration] = useState<CollaborationState>({
    active: false,
    connected: false,
    members: [],
    locks: [],
  });
  const [collaborationOpen, setCollaborationOpen] = useState(false);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateRestarting, setUpdateRestarting] = useState(false);
  const restartGuard = useRef<() => string[]>(() => [
    '앱을 불러오고 있습니다.',
  ]);
  useEffect(() => {
    const requested = window.gameCanvas.onUpdateRestartRequested(async () => {
      const blockers = restartGuard.current();
      if (!blockers.length) flushSync(() => setUpdateRestarting(true));
      return blockers;
    });
    const released = window.gameCanvas.onUpdateRestartReleased(() =>
      setUpdateRestarting(false),
    );
    return () => {
      requested();
      released();
    };
  }, []);
  const [inspectorId, setInspectorId] = useState<string | null>(null);
  const [inspectorAuthorship, setInspectorAuthorship] = useState<{
    path: string;
    value?: FileAuthorship;
    error?: boolean;
  } | null>(null);
  const [compareFirst, setCompareFirst] = useState<string | null>(null);
  const [undoState, setUndoState] = useState<{
    undo: string | null;
    redo: string | null;
  }>({ undo: null, redo: null });
  const [editBusy, setEditBusy] = useState(false);
  const [editStates, setEditStates] = useState<
    Record<string, { dirty: boolean; saving: boolean; failed: boolean }>
  >({});
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const [viewZoom, setViewZoom] = useState(1);
  const panPrevious = useRef<CanvasTool | null>(null);
  const snapLatest = useRef<{ id: string; x: number; y: number } | null>(null);
  const [aiRequest, setAiRequest] = useState<GamejamRequest | null>(null);
  const [aiResultPaths, setAiResultPaths] = useState<string[]>([]);
  const [sectionRename, setSectionRename] = useState<{
    section: CanvasSection;
    title: string;
  } | null>(null);
  const [deleteManyPrompt, setDeleteManyPrompt] = useState<
    CanvasDocument[] | null
  >(null);
  const [workspace, setWorkspace] = useState<WorkspaceState>({
    root: null,
    name: null,
  });
  const [documents, setDocuments] = useState<CanvasDocument[]>([]);
  const [taskDocuments, setTaskDocuments] = useState<CanvasDocument[]>([]);
  const [sections, setSections] = useState<CanvasSection[]>([]);
  const [previews, setPreviews] = useState<PreviewResult[]>([]);
  const [previewWindows, setPreviewWindows] = useState<
    Record<string, PreviewWindowState>
  >({});
  const [creatingTask, setCreatingTask] = useState(false);
  const creatingTaskRef = useRef(false);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [preparingTask, setPreparingTask] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<string | null>(null);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyAiOnly, setHistoryAiOnly] = useState(false);
  const [aiHistorySelection, setAiHistorySelection] =
    useState<HistoryEntry | null>(null);
  const [inspectorAiRecords, setInspectorAiRecords] = useState<{
    path: string;
    entries?: HistoryEntry[];
    error?: boolean;
  } | null>(null);
  const [historySelection, setHistorySelection] = useState<{
    entry: HistoryEntry;
    path: string;
    version: 'before' | 'after';
    content: string | null;
  } | null>(null);
  const [historyConfirm, setHistoryConfirm] = useState<{
    entry: HistoryEntry;
    path?: string;
    version?: 'before' | 'after';
  } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const historyRequest = useRef(0);
  const knownPreviewsRef = useRef<{ root: string | null; paths: Set<string> }>({
    root: null,
    paths: new Set(),
  });
  const projectLoadRef = useRef(0);
  const editorsRef = useRef(new Map<string, () => Promise<void>>());
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedSectionIds, setSelectedSectionIds] = useState<string[]>([]);
  const selectionBeforeClick = useRef(new Set<string>());
  const [sectionDialogOpen, setSectionDialogOpen] = useState(false);
  const [sectionTitle, setSectionTitle] = useState('새 섹션');
  const [notice, setNotice] = useState('프로젝트 폴더를 열어 시작하세요.');
  const [importTarget, setImportTarget] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [imagePurpose, setImagePurpose] = useState<'asset' | 'diagram'>(
    'asset',
  );
  const [importingFiles, setImportingFiles] = useState(false);
  const [importError, setImportError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tool, setTool] = useState<CanvasTool>('select');
  const [uiHidden, setUiHidden] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [documentContextMenu, setDocumentContextMenu] =
    useState<DocumentContextMenuState | null>(null);
  const [sectionContextMenu, setSectionContextMenu] =
    useState<SectionContextMenuState | null>(null);
  const [previewContextMenu, setPreviewContextMenu] =
    useState<PreviewContextMenuState | null>(null);
  const [deletePrompt, setDeletePrompt] = useState<CanvasDocument | null>(null);
  const [sectionActionPrompt, setSectionActionPrompt] =
    useState<SectionActionPrompt | null>(null);
  const [membershipPrompt, setMembershipPrompt] =
    useState<MembershipPrompt | null>(null);
  const [codexStatus, setCodexStatus] = useState<CodexConnectionStatus | null>(
    null,
  );
  const [codexStatusOpen, setCodexStatusOpen] = useState(false);
  const [codexRun, setCodexRun] = useState<CodexRunView | null>(null);
  const [codexRunCollapsed, setCodexRunCollapsed] = useState(true);
  const [completion, setCompletion] = useState<{
    runId: string;
    status: 'completed' | 'failed';
    taskPath: string;
  } | null>(null);
  const notifiedRuns = useRef(new Set<string>());
  const organizedSets = documentSets(documents.map((doc) => doc.relativePath));
  let resultNameError = '';
  try {
    resultName(aiRequest?.resultName);
  } catch (error) {
    resultNameError =
      error instanceof Error ? error.message : '결과 이름을 확인해주세요.';
  }
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
    if (!codexRun) return;
    if (['starting', 'running', 'validating'].includes(codexRun.status)) {
      setCompletion(null);
      return;
    }
    if (
      (codexRun.status === 'completed' || codexRun.status === 'failed') &&
      !notifiedRuns.current.has(codexRun.runId)
    ) {
      notifiedRuns.current.add(codexRun.runId);
      setCompletion({
        runId: codexRun.runId,
        status: codexRun.status,
        taskPath: codexRun.taskPath,
      });
      setCodexRunCollapsed(true);
    }
  }, [codexRun]);
  const [cancellingCodexRun, setCancellingCodexRun] = useState(false);
  const [selectedAiProvider, setSelectedAiProvider] =
    useState<AiProviderId>('codex-cli');
  const [selectedAiModel, setSelectedAiModel] = useState('');
  const [checkingCodex, setCheckingCodex] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('game-canvas-theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  });
  const flowRef = useRef<ReactFlowInstance<CanvasNode> | null>(null);
  const reportEdit = useCallback(
    (id: string, state: { dirty: boolean; saving: boolean; failed: boolean }) =>
      setEditStates((current) =>
        JSON.stringify(current[id]) === JSON.stringify(state)
          ? current
          : { ...current, [id]: state },
      ),
    [],
  );
  useEffect(() => {
    if (inspectorId) {
      setHistoryOpen(false);
      setSettingsOpen(false);
      setCodexRunCollapsed(true);
    }
  }, [inspectorId]);
  useEffect(() => {
    if (settingsOpen) {
      setInspectorId(null);
      setHistoryOpen(false);
      setCodexRunCollapsed(true);
    }
  }, [settingsOpen]);
  useEffect(() => {
    if (navigatorOpen) setHistoryOpen(false);
  }, [navigatorOpen]);
  const codexLogsRef = useRef<HTMLDivElement>(null);
  const canvasClipboardRef = useRef<{
    documents: { id: string; path: string }[];
    pasteCount: number;
  } | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('game-canvas-theme', theme);
  }, [theme]);

  const showError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setNotice(message.replace(/^Error invoking remote method '[^']+': /, ''));
    if (message.includes('잠시 사용할 수 없습니다'))
      setBlockedMessage(
        message.replace(/^Error invoking remote method '[^']+': /, ''),
      );
  };

  const aiBusy =
    preparingTask ||
    (!!codexRun &&
      ['starting', 'running', 'validating'].includes(codexRun.status)) ||
    (!!collaboration.aiRun &&
      ['starting', 'running', 'validating'].includes(
        collaboration.aiRun.status,
      ));
  const canRunAi =
    !collaboration.active ||
    (collaboration.connected &&
      (collaboration.role === 'admin' ||
        (collaboration.role === 'editor' && collaboration.editorAi)));
  const canRestoreHistory =
    !collaboration.active ||
    (collaboration.connected && collaboration.role === 'admin');
  const canStopAi =
    !collaboration.active ||
    (collaboration.connected &&
      (collaboration.role === 'admin' ||
        (collaboration.role === 'editor' &&
          collaboration.aiRun?.actorId === collaboration.memberId)));
  const locked =
    updateRestarting ||
    aiBusy ||
    (collaboration.active &&
      (!collaboration.connected || collaboration.role === 'viewer'));
  const onBlocked = useCallback(() => {
    setBlockedMessage(
      collaboration.active && !collaboration.connected
        ? '협업 서버 연결이 끊겼습니다. 문서 편집을 잠시 중지하고 저장되지 않은 초안은 보관합니다. 재연결 후 최신 내용을 확인해주세요.'
        : collaboration.role === 'viewer'
          ? '현재 뷰어 권한입니다. 관리자에게 편집자 권한을 요청해주세요.'
          : `현재 AI가 ${codexRun?.taskPath.includes('gamejam-') ? 'gamejam! 문서 정리·HTML 구현' : codexRun?.taskPath.includes('implement') ? 'HTML 구현' : '문서 정리'}을 진행하고 있습니다. 결과에 영향을 줄 수 있어 문서 추가·수정·삭제와 배치 변경을 잠시 사용할 수 없습니다. 작업이 끝난 뒤 다시 시도하거나 작업을 중지해주세요.`,
    );
  }, [
    codexRun?.taskPath,
    collaboration.active,
    collaboration.connected,
    collaboration.role,
  ]);
  useEffect(() => {
    void window.gameCanvas
      .getCollaboration()
      .then(setCollaboration)
      .catch(showError);
    return window.gameCanvas.onCollaborationChanged(setCollaboration);
  }, []);
  useEffect(() => {
    const event = collaboration.aiRun;
    if (!event) return;
    setCodexRun((current) =>
      current?.runId === event.runId
        ? {
            ...current,
            status: event.status,
            events:
              current.events.at(-1)?.timestamp === event.timestamp
                ? current.events
                : [...current.events, event].slice(-300),
          }
        : {
            runId: event.runId,
            taskPath: event.taskPath,
            status: event.status,
            events: [event],
            providerId: event.providerId ?? 'codex-cli',
            modelId: event.modelId ?? null,
          },
    );
  }, [collaboration.aiRun]);
  const beginEdit = useCallback(async (document: CanvasDocument) => {
    try {
      await window.gameCanvas.acquireDocumentLock(document.relativePath);
    } catch (error) {
      showError(error);
      throw error;
    }
  }, []);
  const endEdit = useCallback(async (document: CanvasDocument) => {
    await window.gameCanvas.releaseDocumentLock(document.relativePath);
  }, []);
  const registerEditor = useCallback(
    (id: string, flush: (() => Promise<void>) | null) => {
      if (flush) editorsRef.current.set(id, flush);
      else editorsRef.current.delete(id);
    },
    [],
  );
  const openHistory = useCallback(
    (relative: string | null = null, aiOnly = false, entry?: HistoryEntry) => {
      historyRequest.current += 1;
      setHistoryFilter(relative);
      setHistorySelection(null);
      setHistoryAiOnly(aiOnly);
      setAiHistorySelection(entry ?? null);
      setHistoryOpen(true);
      setNavigatorOpen(false);
      setInspectorId(null);
      setSettingsOpen(false);
      setCodexRunCollapsed(true);
      void window.gameCanvas
        .listHistory()
        .then(setHistoryEntries)
        .catch(showError);
    },
    [],
  );
  const inspectHistory = async (
    entry: HistoryEntry,
    relative: string,
    version: 'before' | 'after',
  ) => {
    const request = ++historyRequest.current;
    setAiHistorySelection(null);
    try {
      const content = await window.gameCanvas.readHistoryFile(
        entry.id,
        relative,
        version,
      );
      if (request === historyRequest.current)
        setHistorySelection({ entry, path: relative, version, content });
    } catch (error) {
      showError(error);
    }
  };
  const restoreSelectedHistory = async () => {
    if (!historyConfirm || restoring) return;
    if (locked) {
      onBlocked();
      return;
    }
    setRestoring(true);
    try {
      await Promise.all(
        [...editorsRef.current.values()].map((flush) => flush()),
      );
      await window.gameCanvas.restoreHistory(
        historyConfirm.entry.id,
        historyConfirm.path,
        historyConfirm.version,
      );
      setHistoryConfirm(null);
      await loadProject(false);
      setHistoryEntries(await window.gameCanvas.listHistory());
      setNotice(
        '선택한 버전을 복원했습니다. 복원 직전 내용도 히스토리에 보관됩니다.',
      );
    } catch (error) {
      showError(error);
    } finally {
      setRestoring(false);
    }
  };
  const updatePreviewWindow = useCallback(
    async (relative: string, state: PreviewWindowState) => {
      const normalized = normalizePreviewWindow(state);
      setPreviewWindows((current) => ({ ...current, [relative]: normalized }));
      try {
        await window.gameCanvas.savePreviewWindow(normalized, relative);
      } catch (error) {
        showError(error);
      }
    },
    [],
  );

  const loadProject = useCallback(async (fit = false) => {
    const request = ++projectLoadRef.current;
    try {
      const state = await window.gameCanvas.getWorkspace();
      if (request !== projectLoadRef.current) return;
      setWorkspace(state);
      if (!state.root) {
        setDocuments([]);
        setTaskDocuments([]);
        setSections([]);
        setPreviews([]);
        setPreviewWindows({});
        setLoading(false);
        return;
      }
      const [nextDocuments, nextSections, nextPreviews] = await Promise.all([
        window.gameCanvas.listDocuments(),
        window.gameCanvas.listSections(),
        window.gameCanvas.listPreviews(),
      ]);
      const nextWindows: Record<string, PreviewWindowState> = {};
      const savedWindows = await Promise.all(
        nextPreviews.map((result) =>
          window.gameCanvas.getPreviewWindow(result.relativePath),
        ),
      );
      const canvasDocuments = nextDocuments.filter(isCanvasDocument);
      let right = canvasDocuments.length
        ? Math.max(
            ...canvasDocuments.map((document) => document.x + document.width),
          ) + 120
        : 1100;
      const top = canvasDocuments.length
        ? Math.min(...canvasDocuments.map((document) => document.y))
        : 120;
      if (request !== projectLoadRef.current) return;
      for (const [index, result] of nextPreviews.entries()) {
        const saved = savedWindows[index];
        const layout = saved ??
          result.initialWindow ?? {
            x: right,
            y: top,
            width: 720,
            height: 520,
            collapsed: false,
          };
        nextWindows[result.relativePath] = layout;
        right = Math.max(right, layout.x + layout.width + 120);
        if (!saved)
          await window.gameCanvas.savePreviewWindow(
            layout,
            result.relativePath,
          );
      }
      if (request !== projectLoadRef.current) return;
      setDocuments(canvasDocuments);
      setTaskDocuments(
        nextDocuments.filter(
          (doc) => doc.type === 'ai-task' || isAiTaskPath(doc.relativePath),
        ),
      );
      setSections(nextSections);
      setPreviews(nextPreviews);
      setPreviewWindows(nextWindows);
      setUndoState(await window.gameCanvas.getUndoState());
      if (knownPreviewsRef.current.root !== state.root) {
        setInspectorId(null);
        setHistoryOpen(false);
        setHistoryEntries([]);
        setHistorySelection(null);
        setAiHistorySelection(null);
        setEditStates({});
        setAiRequest(null);
        setAiResultPaths([]);
      }
      const previous = knownPreviewsRef.current;
      const addedResult = nextPreviews.some(
        (result) => !previous.paths.has(result.relativePath),
      );
      knownPreviewsRef.current = {
        root: state.root,
        paths: new Set(nextPreviews.map((result) => result.relativePath)),
      };
      setNotice(
        `${canvasDocuments.length}개 Markdown 문서 · HTML ${nextPreviews.length}개를 불러왔습니다.`,
      );
      setLoading(false);
      if (fit)
        setTimeout(() => void flowRef.current?.fitView({ padding: 0.16 }), 60);
      else if (addedResult && previous.root === state.root)
        setTimeout(
          () =>
            void flowRef.current?.fitView({
              nodes: nextPreviews.map((result) => ({
                id: previewNodeId(result.relativePath),
              })),
              padding: 0.2,
              duration: 350,
            }),
          120,
        );
    } catch (error) {
      if (request !== projectLoadRef.current) return;
      setLoading(false);
      showError(error);
    }
  }, []);

  useEffect(() => {
    void loadProject(true);
    return window.gameCanvas.onWorkspaceChanged(() => void loadProject(false));
  }, [loadProject]);

  useEffect(() => {
    if (!historyOpen) return;
    return window.gameCanvas.onWorkspaceChanged(() => {
      void window.gameCanvas
        .listHistory()
        .then(setHistoryEntries)
        .catch(showError);
    });
  }, [historyOpen]);

  const statusRequestRef = useRef(0);
  const refreshCodexStatus = useCallback(async () => {
    const request = ++statusRequestRef.current;
    setCheckingCodex(true);
    try {
      const status = await window.gameCanvas.getAiStatus(selectedAiProvider);
      if (request === statusRequestRef.current) setCodexStatus(status);
      return status;
    } catch (error) {
      showError(error);
      return null;
    } finally {
      if (request === statusRequestRef.current) setCheckingCodex(false);
    }
  }, [selectedAiProvider]);

  useEffect(() => {
    void refreshCodexStatus();
    void window.gameCanvas
      .getActiveRun()
      .then((event) => {
        if (event)
          setCodexRun(
            (current) =>
              current ?? {
                runId: event.runId,
                taskPath: event.taskPath,
                status: event.status,
                events: [event],
                providerId: event.providerId ?? 'codex-cli',
                modelId: event.modelId ?? null,
              },
          );
      })
      .catch(showError);
  }, [refreshCodexStatus]);

  useEffect(
    () =>
      window.gameCanvas.onCodexRunEvent((event) => {
        setCodexRun((current) => {
          const sameRun = current?.runId === event.runId;
          const events = sameRun ? current.events : ([] as CodexRunEvent[]);
          return {
            runId: event.runId,
            taskPath: event.taskPath,
            status: event.status,
            events: [...events, event].slice(-300),
            providerId:
              event.providerId ?? (sameRun ? current.providerId : 'codex-cli'),
            modelId: event.modelId ?? (sameRun ? current.modelId : null),
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

  const saveDocument = useCallback(
    async (document: CanvasDocument, title: string, body: string) => {
      try {
        await window.gameCanvas.saveDocument({
          relativePath: document.relativePath,
          revision: document.revision,
          title,
          body,
        });
        await loadProject(false);
      } catch (error) {
        showError(error);
        throw error;
      }
    },
    [loadProject],
  );

  const resizeDocument = useCallback(
    async (
      document: CanvasDocument,
      x: number,
      y: number,
      width: number,
      height: number,
    ) => {
      try {
        const parent = sections.find((section) =>
          section.members.some(
            (member) =>
              member.id === document.id ||
              member.path === document.relativePath,
          ),
        );
        await window.gameCanvas.updateDocumentLayout({
          relativePath: document.relativePath,
          revision: document.revision,
          x: x + (parent?.x ?? 0),
          y: y + (parent?.y ?? 0),
          width,
          height,
        });
      } catch (error) {
        showError(error);
      }
    },
    [sections],
  );

  const resizeSection = useCallback(
    async (
      section: CanvasSection,
      x: number,
      y: number,
      width: number,
      height: number,
    ) => {
      try {
        await window.gameCanvas.updateSectionLayout({
          relativePath: section.relativePath,
          revision: section.revision,
          x,
          y,
          width,
          height,
          moveMembers: false,
        });
      } catch (error) {
        showError(error);
      }
    },
    [],
  );

  const focusSource = useCallback(
    (id: string) => {
      const target = documents.find((document) => document.id === id);
      if (!target) {
        const preview = previews.find((item) => item.sourceId === id);
        if (preview) {
          const layout = previewWindows[preview.relativePath];
          if (layout)
            void flowRef.current?.setCenter(
              layout.x + layout.width / 2,
              layout.y + layout.height / 2,
              { zoom: 1, duration: 500 },
            );
          setNodes((current) =>
            current.map((node) => ({
              ...node,
              selected: node.id === previewNodeId(preview.relativePath),
            })),
          );
          return;
        }
        setNotice(`출처 '${id}' 문서를 찾지 못했습니다.`);
        return;
      }
      void flowRef.current?.setCenter(
        target.x + target.width / 2,
        target.y + target.height / 2,
        { zoom: 1, duration: 500 },
      );
      setSelectedIds([target.id]);
      setNodes((current) =>
        current.map((node) => ({ ...node, selected: node.id === target.id })),
      );
    },
    [documents, previews, previewWindows, setNodes],
  );

  const copyTask = useCallback(async (document: CanvasDocument) => {
    await window.gameCanvas.copyText(`# ${document.title}\n\n${document.body}`);
    setNotice('AI 작업 요청을 클립보드에 복사했습니다.');
  }, []);

  const runTaskWithCodex = async (task: CanvasDocument) => {
    if (locked) {
      onBlocked();
      return;
    }
    try {
      await Promise.all(
        [...editorsRef.current.values()].map((flush) => flush()),
      );
      setPreparingTask(true);
      const status = codexStatus ?? (await refreshCodexStatus());
      if (!status?.available || !status.authenticated)
        throw new Error(
          status?.message ?? '선택한 AI CLI 연결을 확인할 수 없습니다.',
        );
      const result = await window.gameCanvas.startCodexRun({
        taskPath: task.relativePath,
        providerId: selectedAiProvider,
        modelId: selectedAiModel || null,
      });
      setCodexRun((current) =>
        current?.runId === result.runId
          ? {
              ...current,
              providerId: result.providerId,
              modelId: result.modelId,
            }
          : {
              runId: result.runId,
              taskPath: result.taskPath,
              status: result.status,
              events: [],
              providerId: result.providerId,
              modelId: result.modelId,
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
      showError(error);
    } finally {
      setPreparingTask(false);
    }
  };

  const cancelCodexRun = async () => {
    if (!codexRun || cancellingCodexRun) return;
    setCancellingCodexRun(true);
    try {
      await window.gameCanvas.cancelCodexRun(codexRun.runId);
      setNotice('AI 작업을 중지하고 있습니다.');
    } catch (error) {
      showError(error);
      setCancellingCodexRun(false);
    }
  };

  const revealDocument = useCallback(async (document: CanvasDocument) => {
    await window.gameCanvas.revealPath(document.relativePath);
  }, []);

  const revealSection = useCallback(async (section: CanvasSection) => {
    await window.gameCanvas.revealPath(section.relativePath);
  }, []);

  const toggleDocumentCollapsed = async (document: CanvasDocument) => {
    try {
      await window.gameCanvas.setDocumentCollapsed({
        relativePath: document.relativePath,
        collapsed: !document.collapsed,
      });
      setDocumentContextMenu(null);
      await loadProject(false);
      setNotice(
        `'${document.title}' 파일을 ${document.collapsed ? '펼쳤습니다.' : '최소화했습니다.'}`,
      );
    } catch (error) {
      showError(error);
    }
  };

  const deleteDocument = async () => {
    if (!deletePrompt) return;
    const document = deletePrompt;
    try {
      await window.gameCanvas.deleteDocument({
        documentId: document.id,
        relativePath: document.relativePath,
        revision: document.revision,
      });
      setDeletePrompt(null);
      setSelectedIds((current) => current.filter((id) => id !== document.id));
      await loadProject(false);
      setNotice(`'${document.title}' 파일을 휴지통으로 이동했습니다.`);
    } catch (error) {
      setDeletePrompt(null);
      showError(error);
    }
  };

  const confirmSectionAction = async () => {
    if (!sectionActionPrompt) return;
    const { section, deleteMembers } = sectionActionPrompt;
    try {
      const result = await window.gameCanvas.deleteSection({
        sectionId: section.id,
        relativePath: section.relativePath,
        revision: section.revision,
        deleteMembers,
      });
      setSectionActionPrompt(null);
      setSectionContextMenu(null);
      setSelectedSectionIds((current) =>
        current.filter((id) => id !== section.id),
      );
      setSelectedIds((current) =>
        deleteMembers
          ? current.filter(
              (id) => !section.members.some((member) => member.id === id),
            )
          : current,
      );
      await loadProject(false);
      if (deleteMembers) {
        const protectedMessage = result.preservedDocumentCount
          ? ` project.md ${result.preservedDocumentCount}개는 보호되어 남겨두었습니다.`
          : '';
        setNotice(
          `'${section.title}' 섹션과 파일 ${result.deletedDocumentCount}개를 휴지통으로 이동했습니다.${protectedMessage}`,
        );
      } else {
        setNotice(
          `'${section.title}' 섹션을 해제했습니다. 파일 ${section.members.length}개는 그대로 유지됩니다.`,
        );
      }
    } catch (error) {
      setSectionActionPrompt(null);
      showError(error);
    }
  };

  useEffect(() => {
    const sectionByMember = new Map<string, CanvasSection>();
    sections.forEach((section) => {
      section.members.forEach((member) => {
        sectionByMember.set(member.id, section);
        sectionByMember.set(member.path, section);
      });
    });
    const sectionNodes: SectionCanvasNode[] = sections.map((section) => ({
      id: sectionNodeId(section.id),
      type: 'section',
      position: { x: section.x, y: section.y },
      style: { width: section.width, height: section.height },
      zIndex: 0,
      draggable: !locked,
      data: {
        kind: 'section',
        locked,
        section,
        onResize: resizeSection,
        onReveal: revealSection,
      },
    }));
    const documentNodes: DocumentCanvasNode[] = documents.map((document) => {
      const foreignLock = collaboration.locks.find(
        (lock) =>
          lock.relativePath === document.relativePath &&
          lock.memberId !== collaboration.memberId,
      );
      const nodeLocked =
        locked ||
        !!foreignLock ||
        (collaboration.active &&
          collaboration.role !== 'admin' &&
          document.type === 'ai-task');
      const parent =
        sectionByMember.get(document.id) ??
        sectionByMember.get(document.relativePath);
      return {
        id: document.id,
        type: 'document',
        position: parent
          ? { x: document.x - parent.x, y: document.y - parent.y }
          : { x: document.x, y: document.y },
        style: {
          width: document.width,
          height: document.collapsed ? 38 : document.height,
        },
        parentId: parent ? sectionNodeId(parent.id) : undefined,
        zIndex: 2,
        dragHandle: '.document-card__header',
        draggable: !nodeLocked,
        data: {
          kind: 'document',
          locked: nodeLocked,
          onBlocked: foreignLock
            ? () =>
                setBlockedMessage(
                  `${foreignLock.nickname}님이 이 문서를 편집 중입니다. 편집을 마칠 때까지 기다려주세요.`,
                )
            : nodeLocked && !locked
              ? () =>
                  setBlockedMessage(
                    'AI 작업 문서는 관리자만 수정할 수 있습니다.',
                  )
              : onBlocked,
          collaborative: collaboration.active,
          draftKey: `game-canvas-draft:${collaboration.projectId ?? workspace.root}:${document.id}`,
          editingBy: collaboration.locks.find(
            (lock) => lock.relativePath === document.relativePath,
          )?.nickname,
          beginEdit,
          endEdit,
          registerEditor,
          document,
          onSave: saveDocument,
          onResize: resizeDocument,
          onSource: focusSource,
          onCopyTask: copyTask,
          onReveal: revealDocument,
          onDetails: () => setInspectorId(document.id),
          onCollapse: () =>
            void window.gameCanvas
              .setDocumentCollapsed({
                relativePath: document.relativePath,
                collapsed: !document.collapsed,
              })
              .then(() => loadProject(false))
              .catch(showError),
          sourceTitles: Object.fromEntries([
            ...documents.map((item) => [item.id, item.title]),
            ...previews
              .filter((item) => item.sourceId)
              .map((item) => [
                item.sourceId!,
                item.title ?? previewLabel(item.relativePath),
              ]),
          ]),
          reportEdit,
        },
      };
    });
    const previewX =
      documents.length > 0
        ? Math.max(
            ...documents.map((document) => document.x + document.width),
          ) + 120
        : 1100;
    const previewY =
      documents.length > 0
        ? Math.min(...documents.map((document) => document.y))
        : 120;
    const previewNodes: PreviewCanvasNode[] = previews.map((preview, index) => {
      const previewWindow = previewWindows[preview.relativePath] ?? {
        x: previewX + index * 840,
        y: previewY,
        width: 720,
        height: 520,
        collapsed: false,
      };
      return {
        id: previewNodeId(preview.relativePath),
        type: 'preview',
        position: {
          x: previewWindow.x,
          y: previewWindow.y,
        },
        style: {
          width: previewWindow.width,
          height: previewWindow.collapsed ? 38 : previewWindow.height,
        },
        dragHandle: '.preview-drag-handle',
        zIndex: 3,
        data: {
          kind: 'preview',
          preview,
          windowState: previewWindow,
          busy: aiBusy,
          onWindowChange: (state) =>
            updatePreviewWindow(preview.relativePath, state),
          onHistory: () => openHistory(preview.relativePath),
          onCompare: () => setCompareFirst(preview.relativePath),
        },
      };
    });
    setNodes((currentNodes) => {
      const selectedNodeIds = new Set(
        currentNodes.filter((node) => node.selected).map((node) => node.id),
      );
      return [...sectionNodes, ...documentNodes, ...previewNodes].map(
        (node) => ({
          ...node,
          selected: selectedNodeIds.has(node.id),
          ...(currentNodes.find((existing) => existing.id === node.id)?.dragging
            ? {
                position: currentNodes.find(
                  (existing) => existing.id === node.id,
                )!.position,
                dragging: true,
              }
            : {}),
        }),
      ) as CanvasNode[];
    });
  }, [
    locked,
    aiBusy,
    collaboration,
    workspace.root,
    beginEdit,
    endEdit,
    onBlocked,
    registerEditor,
    previewWindows,
    updatePreviewWindow,
    openHistory,
    copyTask,
    documents,
    focusSource,
    previews,
    resizeDocument,
    resizeSection,
    revealDocument,
    revealSection,
    saveDocument,
    sections,
    setNodes,
    reportEdit,
    loadProject,
  ]);

  const openWorkspace = async () => {
    try {
      const state = await window.gameCanvas.selectWorkspace();
      setWorkspace(state);
      if (state.root) await loadProject(true);
    } catch (error) {
      showError(error);
    }
  };

  const addIdeaAt = async (x: number, y: number) => {
    if (!workspace.root) return openWorkspace();
    try {
      await window.gameCanvas.createIdea({ x, y });
      await loadProject(false);
      setNotice('새 메모 파일을 만들었습니다. 카드를 클릭해 편집하세요.');
    } catch (error) {
      showError(error);
    }
  };

  const addIdeaNearCenter = async () => {
    const center = flowRef.current?.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    await addIdeaAt(center?.x ?? 160, center?.y ?? 140);
  };

  const createSectionFromSelection = async () => {
    const selected = documents.filter((document) =>
      selectedIds.includes(document.id),
    );
    if (selected.length === 0) {
      setNotice('섹션으로 묶을 문서를 하나 이상 선택하세요.');
      return;
    }
    const minX = Math.min(...selected.map((document) => document.x));
    const minY = Math.min(...selected.map((document) => document.y));
    const maxX = Math.max(
      ...selected.map((document) => document.x + document.width),
    );
    const maxY = Math.max(
      ...selected.map((document) => document.y + document.height),
    );
    try {
      const section = await window.gameCanvas.createSection({
        title: sectionTitle.trim() || '새 섹션',
        x: minX - 48,
        y: minY - 72,
        width: Math.max(maxX - minX + 96, 420),
        height: Math.max(maxY - minY + 120, 280),
        members: selected.map((document) => ({
          id: document.id,
          path: document.relativePath,
        })),
      });
      setSectionDialogOpen(false);
      setSectionTitle('새 섹션');
      setSelectedIds([]);
      await loadProject(false);
      setSelectedSectionIds([section.id]);
      setTimeout(
        () =>
          setNodes((current) =>
            current.map((node) => ({
              ...node,
              selected: node.id === sectionNodeId(section.id),
            })),
          ),
        80,
      );
      setNotice(
        `'${section.title}' 섹션에 ${section.members.length}개 파일을 묶었습니다.`,
      );
    } catch (error) {
      showError(error);
    }
  };

  const openImport = (position?: { x: number; y: number }) => {
    if (locked) return onBlocked();
    if (!workspace.root) {
      void openWorkspace();
      return;
    }
    const center = position ??
      flowRef.current?.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      }) ?? { x: 160, y: 140 };
    setImportTarget(center);
    setImportError('');
  };
  const importFiles = async () => {
    if (!importTarget || importingFiles || locked) return;
    setImportingFiles(true);
    setImportError('');
    try {
      const imported = await window.gameCanvas.importFiles({
        ...importTarget,
        imagePurpose,
      });
      if (!imported.length) {
        setNotice('파일 선택을 취소했습니다.');
        return;
      }
      await loadProject(false);
      setImportTarget(null);
      setTimeout(() => {
        const ids = new Set(
          imported.map((doc) =>
            doc.htmlSource ? previewNodeId(doc.htmlSource) : doc.id,
          ),
        );
        setNodes((nodes) =>
          nodes.map((node) => ({ ...node, selected: ids.has(node.id) })),
        );
        void flowRef.current?.fitView({
          nodes: [...ids].map((id) => ({ id })),
          padding: 0.2,
          duration: 300,
        });
      }, 80);
      setNotice(
        `${imported.length}개 파일을 프로젝트에 복사했습니다. 원본 파일은 변경하지 않았습니다.`,
      );
    } catch (error) {
      showError(error);
      setImportError(
        (error instanceof Error ? error.message : String(error)).replace(
          /^Error invoking remote method '[^']+': /,
          '',
        ),
      );
    } finally {
      setImportingFiles(false);
    }
  };

  const createTask = async (
    kind: 'organize' | 'implement' | 'both' = 'both',
    htmlResult?: HtmlResultChoice,
  ) => {
    if (!canRunAi) {
      setNotice(
        collaboration.role === 'editor'
          ? '편집자 AI 실행에는 서버 v0.8.0 이상이 필요합니다.'
          : 'AI 작업은 연결된 관리자·편집자가 실행할 수 있습니다.',
      );
      return;
    }
    if (creatingTaskRef.current) return;
    if (locked) {
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
    const htmlInputs = nodes.filter(
      (node) => node.selected && node.data.kind === 'preview',
    );
    if (htmlInputs.length > 1) {
      setNotice('HTML 분석은 게임 한 개씩 진행해주세요.');
      return;
    }
    const htmlInput =
      htmlInputs[0]?.data.kind === 'preview'
        ? htmlInputs[0].data.preview
        : undefined;
    const htmlLayout = htmlInput
      ? previewWindows[htmlInput.relativePath]
      : undefined;
    if (selected.length === 0 && selectedSections.length === 0 && !htmlInput) {
      setNotice('문서, 섹션 또는 HTML 게임을 하나 이상 선택하세요.');
      return;
    }
    const maxX = Math.max(
      ...selected.map((document) => document.x + document.width),
      ...selectedSections.map((section) => section.x + section.width),
      ...(htmlLayout ? [htmlLayout.x + htmlLayout.width] : []),
    );
    const minY = Math.min(
      ...selected.map((document) => document.y),
      ...selectedSections.map((section) => section.y),
      ...(htmlLayout ? [htmlLayout.y] : []),
    );
    const inputPaths = [
      ...selectedSections.map((section) => section.relativePath),
      ...selected.map((document) => document.relativePath),
      ...(htmlInput ? [htmlInput.relativePath] : []),
    ];
    setAiRequest({
      organize: kind !== 'implement',
      implement: htmlInput ? kind === 'implement' : kind !== 'organize',
      sourceMode: htmlInput ? 'html' : undefined,
      inputPaths,
      x: maxX + 100,
      y: minY,
      htmlResult: htmlResult ?? {
        mode: 'new',
        ...(htmlInput ? { basePath: htmlInput.relativePath } : {}),
      },
      documentResult: { mode: 'new' },
      instructions: {
        ...DEFAULT_TASK_INSTRUCTIONS,
        organize: defaultTaskInstructions(
          'organize',
          htmlInput ? 'html' : undefined,
        ),
      },
      resultName: htmlInput?.title ?? '',
    });
  };

  const submitAiRequest = async () => {
    if (
      !aiRequest ||
      creatingTaskRef.current ||
      locked ||
      !canRunAi ||
      (!aiRequest.organize && !aiRequest.implement) ||
      (collaboration.active &&
        aiRequest.implement &&
        !collaboration.htmlResultFolders) ||
      (collaboration.active &&
        aiRequest.sourceMode === 'html' &&
        !collaboration.htmlImportAnalysis) ||
      (aiRequest.sourceMode === 'html' &&
        aiRequest.implement &&
        aiRequest.htmlResult?.mode === 'update' &&
        aiRequest.inputPaths.includes(
          aiRequest.htmlResult.basePath ?? 'output/index.html',
        )) ||
      (aiRequest.organize && !aiRequest.instructions.organize.trim()) ||
      (aiRequest.implement && !aiRequest.instructions.implement.trim()) ||
      (collaboration.active &&
        aiRequest.organize &&
        aiRequest.implement &&
        !collaboration.gamejamWorkflow) ||
      !!resultNameError ||
      (collaboration.active && !collaboration.taskInstructionsEditable) ||
      (collaboration.active &&
        !!aiRequest.resultName.trim() &&
        !collaboration.taskResultNaming)
    )
      return;
    creatingTaskRef.current = true;
    setCreatingTask(true);
    try {
      await Promise.all(
        [...editorsRef.current.values()].map((flush) => flush()),
      );
      if (!codexStatus?.available || !codexStatus.authenticated)
        throw new Error(
          'AI 연결 설정에서 선택한 제공자의 연결을 먼저 확인해주세요.',
        );
      const task = await window.gameCanvas.createTask(
        gamejamTaskInput(aiRequest),
      );
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
      setAiRequest(null);
      await runTaskWithCodex(task);
    } catch (error) {
      showError(error);
    } finally {
      creatingTaskRef.current = false;
      setCreatingTask(false);
    }
  };

  const cancelMembershipChange = async () => {
    setMembershipPrompt(null);
    await loadProject(false);
    setNotice('섹션 변경을 취소하고 파일을 원래 위치로 되돌렸습니다.');
  };

  const confirmMembershipChange = async () => {
    if (!membershipPrompt) return;
    const { document, fromSection, toSection, x, y, width, height } =
      membershipPrompt;
    try {
      await window.gameCanvas.moveDocumentToSection({
        documentId: document.id,
        documentPath: document.relativePath,
        revision: document.revision,
        targetSectionId: toSection?.id ?? null,
        x,
        y,
        width,
        height,
      });
      setMembershipPrompt(null);
      await loadProject(false);
      if (fromSection && toSection) {
        setNotice(
          `'${document.title}' 파일을 '${fromSection.title}'에서 '${toSection.title}' 섹션으로 옮겼습니다.`,
        );
      } else if (toSection) {
        setNotice(
          `'${document.title}' 파일을 '${toSection.title}' 섹션에 추가했습니다.`,
        );
      } else if (fromSection) {
        setNotice(
          `'${document.title}' 파일을 '${fromSection.title}' 섹션에서 제외했습니다.`,
        );
      }
    } catch (error) {
      showError(error);
      setMembershipPrompt(null);
      await loadProject(false);
    }
  };

  const selectedDocuments = useMemo(
    () => documents.filter((document) => selectedIds.includes(document.id)),
    [documents, selectedIds],
  );

  const selectedSections = useMemo(
    () => sections.filter((section) => selectedSectionIds.includes(section.id)),
    [sections, selectedSectionIds],
  );

  const arrangementItems = useMemo<ArrangementItem[]>(() => {
    const selectedSectionSet = new Set(selectedSectionIds);
    const membersOfSelectedSections = new Set(
      sections
        .filter((section) => selectedSectionSet.has(section.id))
        .flatMap((section) =>
          section.members.flatMap((member) => [member.id, member.path]),
        ),
    );
    const documentItems = selectedDocuments
      .filter(
        (document) =>
          !membersOfSelectedSections.has(document.id) &&
          !membersOfSelectedSections.has(document.relativePath),
      )
      .map<ArrangementItem>((document) => ({
        key: `document:${document.id}`,
        revision: document.revision,
        kind: 'document',
        relativePath: document.relativePath,
        x: document.x,
        y: document.y,
        width: document.width,
        height: document.collapsed ? 38 : document.height,
        storedHeight: document.height,
      }));
    const sectionItems = selectedSections.map<ArrangementItem>((section) => ({
      key: `section:${section.id}`,
      revision: section.revision,
      kind: 'section',
      relativePath: section.relativePath,
      x: section.x,
      y: section.y,
      width: section.width,
      height: section.height,
      storedHeight: section.height,
    }));
    return [...sectionItems, ...documentItems];
  }, [sections, selectedDocuments, selectedSectionIds, selectedSections]);

  const arrangeSelection = async (action: ArrangementAction) => {
    if (arrangementItems.length < 2) return;
    if (
      (action === 'distribute-x' || action === 'distribute-y') &&
      arrangementItems.length < 3
    ) {
      setNotice('동일 간격 배치에는 3개 이상의 항목이 필요합니다.');
      return;
    }

    const left = Math.min(...arrangementItems.map((item) => item.x));
    const right = Math.max(
      ...arrangementItems.map((item) => item.x + item.width),
    );
    const top = Math.min(...arrangementItems.map((item) => item.y));
    const bottom = Math.max(
      ...arrangementItems.map((item) => item.y + item.height),
    );
    const centerX = (left + right) / 2;
    const centerY = (top + bottom) / 2;
    const positions = new Map(
      arrangementItems.map((item) => [item.key, { x: item.x, y: item.y }]),
    );

    if (action === 'distribute-x') {
      const sorted = [...arrangementItems].sort((a, b) => a.x - b.x);
      const available =
        sorted.at(-1)!.x +
        sorted.at(-1)!.width -
        sorted[0].x -
        sorted.reduce((sum, item) => sum + item.width, 0);
      const gap = available / (sorted.length - 1);
      let cursor = sorted[0].x;
      sorted.forEach((item) => {
        positions.set(item.key, { x: cursor, y: item.y });
        cursor += item.width + gap;
      });
    } else if (action === 'distribute-y') {
      const sorted = [...arrangementItems].sort((a, b) => a.y - b.y);
      const available =
        sorted.at(-1)!.y +
        sorted.at(-1)!.height -
        sorted[0].y -
        sorted.reduce((sum, item) => sum + item.height, 0);
      const gap = available / (sorted.length - 1);
      let cursor = sorted[0].y;
      sorted.forEach((item) => {
        positions.set(item.key, { x: item.x, y: cursor });
        cursor += item.height + gap;
      });
    } else {
      arrangementItems.forEach((item) => {
        const position = positions.get(item.key)!;
        if (action === 'left') position.x = left;
        if (action === 'center-x') position.x = centerX - item.width / 2;
        if (action === 'right') position.x = right - item.width;
        if (action === 'top') position.y = top;
        if (action === 'center-y') position.y = centerY - item.height / 2;
        if (action === 'bottom') position.y = bottom - item.height;
      });
    }

    try {
      await window.gameCanvas.updateLayouts(
        arrangementItems.map((item) => {
          const position = positions.get(item.key)!;
          return item.kind === 'section'
            ? {
                kind: 'section' as const,
                relativePath: item.relativePath,
                revision: item.revision,
                x: position.x,
                y: position.y,
                width: item.width,
                height: item.storedHeight,
                moveMembers: true,
              }
            : {
                kind: 'document' as const,
                relativePath: item.relativePath,
                revision: item.revision,
                x: position.x,
                y: position.y,
                width: item.width,
                height: item.storedHeight,
              };
        }),
      );
      await loadProject(false);
      setNotice(`${arrangementItems.length}개 항목의 배치를 정리했습니다.`);
    } catch (error) {
      showError(error);
    }
  };

  const persistDraggedNodes = async (
    primaryNode: CanvasNode,
    draggedNodes: CanvasNode[],
  ) => {
    const movedNodes = draggedNodes.length > 0 ? draggedNodes : [primaryNode];
    for (const moved of movedNodes) {
      if (moved.data.kind === 'preview') {
        await updatePreviewWindow(moved.data.preview.relativePath, {
          ...moved.data.windowState,
          x: moved.position.x,
          y: moved.position.y,
          width: moved.measured?.width ?? moved.data.windowState.width,
          height: moved.data.windowState.collapsed
            ? moved.data.windowState.height
            : (moved.measured?.height ?? moved.data.windowState.height),
        });
      }
    }
    if (!movedNodes.some((node) => node.data.kind !== 'preview')) return;
    if (locked) return;

    if (movedNodes.length > 1) {
      const movedSectionNodeIds = new Set(
        movedNodes.flatMap((node) =>
          node.data.kind === 'section' ? [node.id] : [],
        ),
      );
      const movedSections = movedNodes.filter(
        (node): node is SectionCanvasNode => node.data.kind === 'section',
      );
      const movedDocuments = movedNodes.filter(
        (node): node is DocumentCanvasNode =>
          node.data.kind === 'document' &&
          (!node.parentId || !movedSectionNodeIds.has(node.parentId)),
      );

      try {
        const updates: Parameters<typeof window.gameCanvas.updateLayouts>[0] =
          [];
        for (const sectionNode of movedSections) {
          const section = sectionNode.data.section;
          updates.push({
            kind: 'section',
            relativePath: section.relativePath,
            revision: section.revision,
            x: sectionNode.position.x,
            y: sectionNode.position.y,
            width: sectionNode.measured?.width ?? section.width,
            height: sectionNode.measured?.height ?? section.height,
            moveMembers: true,
          });
        }

        updates.push(
          ...movedDocuments.map((documentNode) => {
            const document = documentNode.data.document;
            const renderedParent = sections.find(
              (section) => documentNode.parentId === sectionNodeId(section.id),
            );
            const visibleHeight =
              documentNode.measured?.height ?? document.height;
            return {
              kind: 'document' as const,
              relativePath: document.relativePath,
              revision: document.revision,
              x: documentNode.position.x + (renderedParent?.x ?? 0),
              y: documentNode.position.y + (renderedParent?.y ?? 0),
              width: documentNode.measured?.width ?? document.width,
              height: document.collapsed ? document.height : visibleHeight,
            };
          }),
        );
        await window.gameCanvas.updateLayouts(updates);

        await loadProject(false);
        setNotice(`${movedNodes.length}개 항목의 위치를 함께 저장했습니다.`);
      } catch (error) {
        showError(error);
        await loadProject(false);
      }
      return;
    }

    const node = movedNodes[0];
    if (node.data.kind === 'section') {
      const section = node.data.section;
      try {
        await window.gameCanvas.updateSectionLayout({
          relativePath: section.relativePath,
          revision: section.revision,
          x: node.position.x,
          y: node.position.y,
          width: node.measured?.width ?? section.width,
          height: node.measured?.height ?? section.height,
          moveMembers: true,
        });
        await loadProject(false);
      } catch (error) {
        showError(error);
      }
      return;
    }
    if (node.data.kind !== 'document') return;

    const document = node.data.document;
    const originalSection = sections.find((section) =>
      section.members.some(
        (member) =>
          member.id === document.id || member.path === document.relativePath,
      ),
    );
    const renderedParent = sections.find(
      (section) => node.parentId === sectionNodeId(section.id),
    );
    const x = node.position.x + (renderedParent?.x ?? 0);
    const y = node.position.y + (renderedParent?.y ?? 0);
    const width = node.measured?.width ?? document.width;
    const visibleHeight = node.measured?.height ?? document.height;
    const height = document.collapsed ? document.height : visibleHeight;
    const centerX = x + width / 2;
    const centerY = y + visibleHeight / 2;
    const targetSection = [...sections]
      .filter(
        (section) =>
          centerX >= section.x &&
          centerX <= section.x + section.width &&
          centerY >= section.y &&
          centerY <= section.y + section.height,
      )
      .sort(
        (leftSection, rightSection) =>
          leftSection.width * leftSection.height -
          rightSection.width * rightSection.height,
      )[0];

    if ((originalSection?.id ?? null) !== (targetSection?.id ?? null)) {
      setMembershipPrompt({
        document,
        fromSection: originalSection ?? null,
        toSection: targetSection ?? null,
        x,
        y,
        width,
        height,
      });
      return;
    }

    try {
      await window.gameCanvas.updateDocumentLayout({
        relativePath: document.relativePath,
        revision: document.revision,
        x,
        y,
        width,
        height,
      });
    } catch (error) {
      showError(error);
      await loadProject(false);
    }
  };

  const copyCanvasSelection = useCallback(() => {
    const copiedDocuments = documents
      .filter((document) => selectedIds.includes(document.id))
      .map((document) => ({ id: document.id, path: document.relativePath }));
    if (copiedDocuments.length === 0) {
      setNotice('복사할 메모 또는 파일을 선택하세요.');
      return;
    }
    canvasClipboardRef.current = {
      documents: copiedDocuments,
      pasteCount: 0,
    };
    setNotice(`${copiedDocuments.length}개 파일을 복사했습니다.`);
  }, [documents, selectedIds]);

  const pasteCanvasSelection = useCallback(async () => {
    const copied = canvasClipboardRef.current;
    if (!copied || copied.documents.length === 0) {
      setNotice('먼저 Ctrl+C로 메모 또는 파일을 복사하세요.');
      return;
    }
    copied.pasteCount += 1;
    const offset = copied.pasteCount * 32;
    try {
      const created = await window.gameCanvas.duplicateDocuments({
        documents: copied.documents,
        offsetX: offset,
        offsetY: offset,
      });
      const createdIds = created.map((document) => document.id);
      setSelectedIds(createdIds);
      setSelectedSectionIds([]);
      await loadProject(false);
      setTimeout(
        () =>
          setNodes((current) =>
            current.map((node) => ({
              ...node,
              selected:
                node.data.kind === 'document' &&
                createdIds.includes(node.data.document.id),
            })),
          ),
        80,
      );
      setNotice(`${created.length}개 파일의 복사본을 만들었습니다.`);
    } catch (error) {
      showError(error);
    }
  }, [loadProject, setNodes]);

  const flushEditors = async () => {
    await Promise.all([...editorsRef.current.values()].map((flush) => flush()));
  };
  const changeEdit = async (direction: 'undo' | 'redo') => {
    if (locked) {
      onBlocked();
      return;
    }
    if (editBusy) return;
    setEditBusy(true);
    try {
      await flushEditors();
      await window.gameCanvas[direction]();
      await loadProject(false);
      setNotice(
        direction === 'undo'
          ? '내 작업을 되돌렸습니다.'
          : '내 작업을 다시 실행했습니다.',
      );
    } catch (error) {
      showError(error);
    } finally {
      setEditBusy(false);
    }
  };
  const jumpTo = (id: string) => {
    const node = nodes.find((item) => item.id === id);
    if (!node) return;
    setTool('select');
    setSelectedIds(
      node.data.kind === 'document' ? [node.data.document.id] : [],
    );
    setSelectedSectionIds(
      node.data.kind === 'section' ? [node.data.section.id] : [],
    );
    setNodes((current) =>
      current.map((item) => ({ ...item, selected: item.id === id })),
    );
    void flowRef.current?.fitView({
      nodes: [{ id }],
      padding: 0.6,
      maxZoom: 1,
      duration: 300,
    });
  };
  const duplicateSelection = async () => {
    if (locked) {
      onBlocked();
      return;
    }
    try {
      await flushEditors();
      const created = await window.gameCanvas.duplicateDocuments({
        documents: selectedDocuments.map((item) => ({
          id: item.id,
          path: item.relativePath,
        })),
        offsetX: 56,
        offsetY: 56,
      });
      await loadProject(false);
      setSelectedIds(created.map((item) => item.id));
      setSelectedSectionIds([]);
      setNodes((current) =>
        current.map((item) => ({
          ...item,
          selected: created.some((doc) => doc.id === item.id),
        })),
      );
      setNotice(`${created.length}개 문서를 복제했습니다.`);
    } catch (error) {
      showError(error);
    }
  };
  const selectionSection = () => {
    if (locked) {
      onBlocked();
      return;
    }
    if (!selectedDocuments.length) {
      setNotice('묶을 메모나 파일을 먼저 선택해주세요.');
      return;
    }
    setSectionTitle('새 섹션');
    setSectionDialogOpen(true);
  };
  const minimizeSelection = async () => {
    try {
      await flushEditors();
      const selected = nodes.filter((node) => node.selected);
      const expand = selected.some((node) =>
        node.data.kind === 'document'
          ? node.data.document.collapsed
          : node.data.kind === 'preview'
            ? node.data.windowState.collapsed
            : false,
      );
      for (const node of selected) {
        if (node.data.kind === 'document')
          await window.gameCanvas.setDocumentCollapsed({
            relativePath: node.data.document.relativePath,
            collapsed: !expand,
          });
        if (node.data.kind === 'preview')
          await updatePreviewWindow(node.data.preview.relativePath, {
            ...node.data.windowState,
            collapsed: !expand,
          });
      }
      await loadProject(false);
    } catch (error) {
      showError(error);
    }
  };
  const requestDelete = () => {
    if (locked) {
      onBlocked();
      return;
    }
    if (selectedDocuments.length) {
      setDeleteManyPrompt(selectedDocuments);
      return;
    }
    if (selectedSections.length === 1)
      setSectionActionPrompt({
        section: selectedSections[0],
        deleteMembers: true,
      });
    else
      setNotice(
        '삭제할 메모·파일 또는 섹션 하나를 선택해주세요. HTML 결과 파일은 히스토리로 관리합니다.',
      );
  };
  const compareWindows = async (a: string, b: string, presetId: string) => {
    if (a === b) throw new Error('서로 다른 버전을 선택해주세요.');
    let first = previewWindows[a],
      second = previewWindows[b];
    if (!first || !second) throw new Error('결과 창을 찾을 수 없습니다.');
    if (presetId) {
      first = selectPreviewPreset(first, presetId);
      second = selectPreviewPreset(second, presetId);
    }
    first = { ...first, collapsed: false };
    second = {
      ...second,
      collapsed: false,
      x: first.x + first.width + 48,
      y: first.y,
    };
    await Promise.all([
      window.gameCanvas.savePreviewWindow(first, a),
      window.gameCanvas.savePreviewWindow(second, b),
    ]);
    setPreviewWindows((current) => ({ ...current, [a]: first, [b]: second }));
    setTimeout(
      () =>
        void flowRef.current?.fitView({
          nodes: [{ id: previewNodeId(a) }, { id: previewNodeId(b) }],
          padding: 0.16,
          duration: 300,
        }),
      80,
    );
    setNotice('두 결과를 나란히 배치했습니다.');
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (document.fullscreenElement?.classList.contains('preview-card'))
        return;
      if (document.activeElement?.tagName === 'IFRAME') return;
      const dialog = !!document.querySelector('[aria-modal="true"]');
      const action = canvasShortcut(event, {
        editable: !!target?.closest(
          'input, textarea, select, [contenteditable="true"], [data-editor-owner]',
        ),
        dialog,
        playing: document.activeElement?.tagName === 'IFRAME',
      });
      if (action) {
        event.preventDefault();
        if (action === 'search') setCommandOpen(true);
        if (action === 'navigator') setNavigatorOpen((value) => !value);
        if (action === 'help') setShortcutsOpen(true);
        if (action === 'import') openImport();
        if (action === 'undo') void changeEdit('undo');
        if (action === 'redo') void changeEdit('redo');
        if (action === 'save')
          void flushEditors()
            .then(() => setNotice('편집 내용을 저장했습니다.'))
            .catch(showError);
        if (action === 'organize') void createTask();
        if (action === 'implement') void createTask('implement');
        if (action === 'section') selectionSection();
        if (action === 'duplicate' && selectedDocuments.length)
          void duplicateSelection();
        if (action === 'delete') requestDelete();
        if (action === 'minimize') void minimizeSelection();
        if (action === 'fit')
          void flowRef.current?.fitView({ padding: 0.16, duration: 250 });
        if (action === 'selection-fit')
          void flowRef.current?.fitView({
            nodes: nodes
              .filter((node) => node.selected)
              .map((node) => ({ id: node.id })),
            padding: 0.3,
            maxZoom: 1,
            duration: 250,
          });
        if (action === 'zoom-in') void flowRef.current?.zoomIn();
        if (action === 'zoom-out') void flowRef.current?.zoomOut();
        if (action === 'history') void openHistory();
        if (action === 'ui') setUiHidden((value) => !value);
        if (action === 'select') setTool('select');
        if (action === 'hand') setTool('hand');
        if (action === 'note') {
          if (locked) onBlocked();
          else setTool('note');
        }
        if (action === 'pan') {
          panPrevious.current = tool;
          setTool('hand');
        }
        if (action === 'all') {
          event.preventDefault();
          const allDocumentIds = documents.map((document) => document.id);
          setSelectedIds(allDocumentIds);
          setSelectedSectionIds([]);
          setNodes((current) =>
            current.map((node) => ({
              ...node,
              selected: node.data.kind === 'document',
            })),
          );
          setNotice(`전체 파일 ${allDocumentIds.length}개를 선택했습니다.`);
        } else if (action === 'copy') {
          event.preventDefault();
          copyCanvasSelection();
        } else if (action === 'paste') {
          event.preventDefault();
          void pasteCanvasSelection();
        }
        return;
      }

      if (
        event.key === 'Escape' &&
        !dialog &&
        !target?.closest('input,textarea,select,[contenteditable="true"]')
      ) {
        setInspectorId(null);
        setSettingsOpen(false);
        setContextMenu(null);
        setDocumentContextMenu(null);
        setSectionContextMenu(null);
        setPreviewContextMenu(null);
        setDeletePrompt(null);
        setSectionActionPrompt(null);
        setCodexStatusOpen(false);
        setSelectedIds([]);
        setSelectedSectionIds([]);
        setNodes((current) =>
          current.map((node) => ({ ...node, selected: false })),
        );
      }
    };
    const releasePan = () => {
      if (panPrevious.current) {
        setTool(panPrevious.current);
        panPrevious.current = null;
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.key === ' ') releasePan();
    };
    window.addEventListener('keydown', handleShortcut);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', releasePan);
    return () => {
      window.removeEventListener('keydown', handleShortcut);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', releasePan);
    };
  });

  const legacyModal = !!(
    updateOpen ||
    importTarget ||
    aiRequest ||
    sectionRename ||
    deleteManyPrompt ||
    sectionDialogOpen ||
    deletePrompt ||
    sectionActionPrompt ||
    membershipPrompt ||
    historyConfirm ||
    blockedMessage ||
    codexStatusOpen ||
    collaborationOpen
  );
  useEffect(() => {
    if (!legacyModal || commandOpen || shortcutsOpen || compareFirst !== null)
      return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = document.querySelector<HTMLElement>(
      '.dialog-backdrop [aria-modal="true"]',
    );
    if (!dialog) return;
    const focusable = () =>
      [
        ...dialog.querySelectorAll<HTMLElement>(
          'input:not(:disabled),textarea:not(:disabled),select:not(:disabled),button:not(:disabled),[tabindex="0"]',
        ),
      ].filter((element) => element.getClientRects().length);
    if (!dialog.contains(document.activeElement))
      (
        dialog.querySelector<HTMLElement>('[autofocus]') ?? focusable()[0]
      )?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = focusable(),
        first = elements[0],
        last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    dialog.addEventListener('keydown', trap);
    return () => {
      dialog.removeEventListener('keydown', trap);
      if (previous?.isConnected) previous.focus();
    };
  }, [legacyModal, commandOpen, shortcutsOpen, compareFirst]);

  const hasTaskSelection =
    canRunAi &&
    (selectedDocuments.length > 0 ||
      selectedSections.length > 0 ||
      nodes.some((node) => node.selected && node.data.kind === 'preview'));
  const inputSelection = [
    ...new Map(
      [
        ...selectedDocuments,
        ...selectedSections.flatMap((section) =>
          documents.filter((doc) =>
            section.members.some(
              (member) =>
                member.id === doc.id || member.path === doc.relativePath,
            ),
          ),
        ),
      ].map((doc) => [doc.id, doc]),
    ).values(),
  ];
  const relevantEdits = documents
    .map((doc) => editStates[doc.id])
    .filter(Boolean);
  restartGuard.current = () => {
    const reasons: string[] = [];
    if (
      editorsRef.current.size ||
      relevantEdits.some((edit) => edit.dirty || edit.saving || edit.failed) ||
      document.querySelector(
        '[contenteditable="true"]:focus, .react-flow__node.dragging',
      )
    )
      reasons.push('메모 편집·이동을 마치고 저장 상태를 확인해주세요.');
    if (aiBusy || creatingTask || preparingTask)
      reasons.push('AI 작업이 진행 중입니다. 완료하거나 중지해주세요.');
    if (loading || editBusy || importingFiles || restoring)
      reasons.push('파일 처리·저장·동기화가 진행 중입니다. 잠시 기다려주세요.');
    if (aiRequest || sectionRename || importTarget || historyConfirm)
      reasons.push(
        '열려 있는 작업·편집 대화상자를 먼저 완료하거나 취소해주세요.',
      );
    if (collaboration.active && !collaboration.connected)
      reasons.push('협업 서버에 재연결한 뒤 저장 상태를 확인해주세요.');
    return reasons;
  };
  const saveLabel =
    collaboration.active && !collaboration.connected
      ? '서버 연결 끊김'
      : relevantEdits.some((edit) => edit.failed)
        ? '저장 실패 · 다시 확인 필요'
        : relevantEdits.some((edit) => edit.saving)
          ? '저장 중…'
          : relevantEdits.some((edit) => edit.dirty)
            ? '수정 중 · Ctrl+S로 저장'
            : collaboration.active
              ? '서버 저장 완료'
              : '로컬 저장 완료';
  const aiDisabledReason = !canRunAi
    ? collaboration.connected
      ? collaboration.role === 'editor'
        ? '서버 업데이트 필요 (v0.8.0)'
        : '뷰어는 실행 불가'
      : '서버 연결 필요'
    : aiBusy
      ? 'AI 작업 진행 중'
      : !hasTaskSelection
        ? '문서·섹션·HTML 게임을 먼저 선택해주세요'
        : '';
  const canvasItems: CanvasItem[] = [];
  const listed = new Set<string>();
  const toItem = (doc: CanvasDocument, parent?: string): CanvasItem => ({
    id: doc.id,
    title: doc.title,
    kind:
      doc.type === 'image'
        ? 'image'
        : doc.type === 'reference'
          ? 'reference'
          : doc.type === 'idea'
            ? 'idea'
            : doc.type === 'ai-task'
              ? 'task'
              : 'document',
    path: doc.relativePath,
    description: doc.body,
    parent,
    editingBy: collaboration.locks.find(
      (lock) => lock.relativePath === doc.relativePath,
    )?.nickname,
  });
  for (const section of sections) {
    canvasItems.push({
      id: sectionNodeId(section.id),
      title: section.title,
      kind: 'section',
      path: section.relativePath,
      description: `포함 문서 ${section.members.length}개`,
    });
    for (const member of section.members) {
      const doc = documents.find(
        (doc) => doc.id === member.id || doc.relativePath === member.path,
      );
      if (doc) {
        listed.add(doc.id);
        canvasItems.push(toItem(doc, section.title));
      }
    }
  }
  for (const doc of documents)
    if (!listed.has(doc.id)) canvasItems.push(toItem(doc));
  for (const preview of previews)
    canvasItems.push({
      id: previewNodeId(preview.relativePath),
      title: `HTML ${preview.title ?? previewLabel(preview.relativePath)}`,
      kind: 'html',
      path: preview.relativePath,
      description: previewWindows[preview.relativePath]
        ? `${previewViewport(previewWindows[preview.relativePath]).width} × ${previewViewport(previewWindows[preview.relativePath]).height}`
        : '',
    });
  const inspectorPath = canvasItems.find(
    (item) => item.id === inspectorId,
  )?.path;
  const inspectorVersion =
    documents.find((doc) => doc.id === inspectorId)?.modifiedAt ??
    sections.find((section) => sectionNodeId(section.id) === inspectorId)
      ?.modifiedAt ??
    previews.find(
      (preview) => previewNodeId(preview.relativePath) === inspectorId,
    )?.content;
  useEffect(() => {
    if (!inspectorPath) {
      setInspectorAuthorship(null);
      return;
    }
    let cancelled = false;
    setInspectorAuthorship({ path: inspectorPath });
    void window.gameCanvas
      .getFileAuthorship(inspectorPath)
      .then((value) => {
        if (!cancelled) setInspectorAuthorship({ path: inspectorPath, value });
      })
      .catch(() => {
        if (!cancelled)
          setInspectorAuthorship({ path: inspectorPath, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [inspectorPath, inspectorVersion, workspace.root, collaboration.revision]);

  useEffect(() => {
    if (!inspectorPath || inspectorPath.startsWith('sections/')) {
      setInspectorAiRecords(null);
      return;
    }
    let cancelled = false;
    setInspectorAiRecords({ path: inspectorPath });
    void window.gameCanvas
      .listHistory()
      .then((entries) => {
        if (!cancelled) setInspectorAiRecords({ path: inspectorPath, entries });
      })
      .catch(() => {
        if (!cancelled)
          setInspectorAiRecords({ path: inspectorPath, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [
    inspectorPath,
    inspectorVersion,
    workspace.root,
    collaboration.revision,
    codexRun?.status,
  ]);

  const filteredHistoryEntries = historyEntries.filter(
    (entry) =>
      (!historyAiOnly || entry.kind === 'ai' || !!historyTaskPath(entry)) &&
      (!historyFilter ||
        historyTaskPath(entry) === historyFilter ||
        entry.files.some((file) => file.relativePath === historyFilter) ||
        (entry.kind === 'ai' &&
          entryTaskRecord(entry, taskDocuments)?.outputs.includes(
            historyFilter,
          ))),
  );

  const focusResultPath = (path: string) => {
    const node = nodes.find((node) =>
      node.data.kind === 'document'
        ? node.data.document.relativePath === path
        : node.data.kind === 'preview' &&
          node.data.preview.relativePath === path,
    );
    if (!node) {
      setNotice(
        '이 결과 파일은 현재 캔버스에 없습니다. 파일 변경 기록에서 이전 내용을 확인해주세요.',
      );
      return;
    }
    setHistoryOpen(false);
    setInspectorId(null);
    jumpTo(node.id);
  };

  const commands: CanvasCommand[] = [
    {
      id: 'import',
      title: 'Markdown · HTML 게임 · 이미지 파일 불러오기',
      shortcut: 'Ctrl+I',
      disabled: locked,
      reason: '문서 편집 잠김',
      run: () => openImport(),
    },
    {
      id: 'note',
      title: '새 아이디어 메모 만들기',
      shortcut: 'N',
      disabled: locked,
      reason: '문서 편집 잠김',
      run: () => void addIdeaNearCenter(),
    },
    {
      id: 'gamejam',
      title: 'gamejam! · 문서 정리 / HTML 구현',
      shortcut: 'Ctrl+Enter',
      disabled: !hasTaskSelection || aiBusy,
      reason: aiDisabledReason,
      run: () => void createTask(),
    },
    {
      id: 'section',
      title: '선택 파일로 섹션 만들기',
      shortcut: 'Ctrl+G',
      disabled: !selectedDocuments.length || locked,
      reason: '편집 가능한 문서를 선택해주세요',
      run: selectionSection,
    },
    {
      id: 'duplicate',
      title: '선택 파일 복제',
      shortcut: 'Ctrl+D',
      disabled: !selectedDocuments.length || locked,
      reason: '편집 가능한 문서를 선택해주세요',
      run: () => void duplicateSelection(),
    },
    {
      id: 'undo',
      title: '내 작업 실행 취소',
      shortcut: 'Ctrl+Z',
      disabled: !undoState.undo || locked || editBusy,
      reason: '되돌릴 작업 없음 또는 편집 잠김',
      run: () => void changeEdit('undo'),
    },
    {
      id: 'redo',
      title: '내 작업 다시 실행',
      shortcut: 'Ctrl+Shift+Z',
      disabled: !undoState.redo || locked || editBusy,
      reason: '다시 실행할 작업 없음 또는 편집 잠김',
      run: () => void changeEdit('redo'),
    },
    {
      id: 'fit',
      title: '캔버스 전체 보기',
      shortcut: 'Shift+1',
      run: () =>
        void flowRef.current?.fitView({ padding: 0.16, duration: 250 }),
    },
    {
      id: 'navigator',
      title: '문서 목록 열기',
      shortcut: 'L',
      run: () => setNavigatorOpen(true),
    },
    {
      id: 'history',
      title: '프로젝트 히스토리',
      shortcut: 'Ctrl+Shift+H',
      run: () => void openHistory(),
    },
    {
      id: 'compare',
      title: 'HTML 버전 비교',
      run: () => setCompareFirst(previews[0]?.relativePath ?? ''),
    },
    {
      id: 'invite',
      title: '참여자 및 초대 코드',
      run: () => setCollaborationOpen(true),
    },
    {
      id: 'ai-settings',
      title: 'AI 연결 설정',
      run: () => setCodexStatusOpen(true),
    },
    { id: 'app-update', title: '앱 업데이트', run: () => setUpdateOpen(true) },
    {
      id: 'help',
      title: '단축키 안내',
      shortcut: '?',
      run: () => setShortcutsOpen(true),
    },
  ];

  const collaborationDialog = collaborationOpen ? (
    <CollaborationPanel
      state={collaboration}
      close={() => setCollaborationOpen(false)}
      beforeSwitch={async () => {
        await Promise.all(
          [...editorsRef.current.values()].map((flush) => flush()),
        );
      }}
      changed={async () => {
        setCollaboration(await window.gameCanvas.getCollaboration());
        await loadProject(true);
      }}
      report={setNotice}
    />
  ) : null;

  const toggleTheme = () =>
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));

  const openCanvasMenu = (clientX: number, clientY: number) => {
    const point = flowRef.current?.screenToFlowPosition({
      x: clientX,
      y: clientY,
    });
    if (!point) return;
    setDocumentContextMenu(null);
    setSectionContextMenu(null);
    setPreviewContextMenu(null);
    setContextMenu({
      screenX: Math.min(clientX, window.innerWidth - 282),
      screenY: Math.min(clientY, window.innerHeight - 340),
      flowX: point.x,
      flowY: point.y,
    });
  };

  if (!workspace.root && !loading) {
    return (
      <main className="welcome-screen">
        <button
          type="button"
          className="welcome-theme-button icon-button"
          onClick={toggleTheme}
          title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <div className="welcome-mark">GC</div>
        <p className="eyebrow">LOCAL-FIRST GAME PROTOTYPING</p>
        <h1>
          아이디어를 흩어놓고,
          <br />
          Markdown으로 정리하세요.
        </h1>
        <p>
          프로젝트 폴더 안의 문서만 다루는 무한 캔버스입니다. 외부 AI가 만든
          문서와 HTML 결과도 자동으로 불러옵니다.
        </p>
        <button
          type="button"
          className="button-primary button-large"
          onClick={openWorkspace}
        >
          <FolderOpen size={18} /> 프로젝트 폴더 열기
        </button>
        <button type="button" onClick={() => setCollaborationOpen(true)}>
          <Users size={18} /> 초대 코드로 참여
        </button>
        <button type="button" onClick={() => setUpdateOpen(true)}>
          앱 업데이트
        </button>
        <UpdatePanel
          open={updateOpen}
          close={() => setUpdateOpen(false)}
          show={() => setUpdateOpen(true)}
        />
        {collaborationDialog}
      </main>
    );
  }

  return (
    <main
      className={`app-shell app-shell--tool-${tool}${codexRun ? ' app-shell--has-run' : ''}${completion && codexRunCollapsed ? ' app-shell--has-completion' : ''}`}
    >
      <UpdatePanel
        open={updateOpen}
        close={() => setUpdateOpen(false)}
        show={() => setUpdateOpen(true)}
      />
      {updateRestarting && (
        <div className="update-restarting" role="alert" aria-busy="true">
          작업 보호 확인 완료 · 업데이트 후 재시작 중…
        </div>
      )}
      {collaboration.active && !collaboration.connected && (
        <div
          className={`collaboration-status floating-surface ${collaboration.connected ? '' : 'is-offline'}`}
        >
          {collaboration.connected
            ? `공동 작업 · ${collaboration.role ? ROLE_NAMES[collaboration.role] : '연결 중'} · 서버 저장 버전 ${collaboration.revision ?? '…'}`
            : '서버 연결 끊김 · 초안 보관 · 편집 일시 중지'}
        </div>
      )}
      {collaborationDialog}
      {navigatorOpen && (
        <CanvasNavigator
          items={canvasItems}
          jump={jumpTo}
          close={() => setNavigatorOpen(false)}
        />
      )}
      {commandOpen && (
        <CommandPalette
          items={canvasItems}
          commands={commands}
          jump={jumpTo}
          close={() => setCommandOpen(false)}
        />
      )}
      {shortcutsOpen && (
        <ShortcutDialog close={() => setShortcutsOpen(false)} />
      )}
      {compareFirst !== null && (
        <CompareDialog
          previews={previews}
          first={compareFirst || undefined}
          onCompare={compareWindows}
          close={() => setCompareFirst(null)}
        />
      )}
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
          <button onClick={() => void window.gameCanvas.openWorkspace()}>
            <FolderOpen size={16} /> 프로젝트 폴더 열기
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
      {inspectorId &&
        (() => {
          const item = canvasItems.find((item) => item.id === inspectorId),
            doc = documents.find((doc) => doc.id === inspectorId),
            section = sections.find(
              (section) => sectionNodeId(section.id) === inspectorId,
            ),
            preview = previews.find(
              (preview) => previewNodeId(preview.relativePath) === inspectorId,
            );
          if (!item) return null;
          return (
            <aside
              className="object-inspector floating-surface"
              aria-label="선택 항목 상세 정보"
            >
              <header>
                <strong>상세 정보</strong>
                <button
                  className="icon-button"
                  title="상세 정보 닫기"
                  onClick={() => setInspectorId(null)}
                >
                  <X size={16} />
                </button>
              </header>
              <h3>{item.title}</h3>
              <dl>
                <dt>파일</dt>
                <dd>
                  <code>{item.path}</code>
                </dd>
                {(doc || section || preview?.sourceId) && (
                  <>
                    <dt>ID</dt>
                    <dd>
                      <code>{doc?.id ?? section?.id ?? preview?.sourceId}</code>
                    </dd>
                  </>
                )}
                {doc && (
                  <>
                    <dt>문서 유형</dt>
                    <dd>
                      {TYPE_LABELS[doc.type]} · {statusLabel(doc.status)}
                    </dd>
                    <dt>위치 · 크기</dt>
                    <dd>
                      {doc.x}, {doc.y} · {doc.width} × {doc.height}
                    </dd>
                    <dt>최근 변경</dt>
                    <dd>{new Date(doc.modifiedAt).toLocaleString('ko-KR')}</dd>
                    <dt>소속 섹션</dt>
                    <dd>{item.parent ?? '섹션 없음'}</dd>
                  </>
                )}
              </dl>
              <dl className="inspector-authorship">
                <dt>생성한 사람</dt>
                <dd>
                  {inspectorAuthorship?.path === item.path &&
                  inspectorAuthorship.value
                    ? authorLabel(inspectorAuthorship.value.createdBy)
                    : inspectorAuthorship?.path === item.path &&
                        inspectorAuthorship.error
                      ? '정보를 불러오지 못했습니다'
                      : '기록 불러오는 중…'}
                  {inspectorAuthorship?.path === item.path &&
                    inspectorAuthorship.value?.createdAt && (
                      <small>
                        {new Date(
                          inspectorAuthorship.value.createdAt,
                        ).toLocaleString('ko-KR')}
                      </small>
                    )}
                </dd>
                <dt title="본문·제목·위치·크기·섹션 등 파일 변경을 포함합니다">
                  마지막으로 편집한 사람
                </dt>
                <dd>
                  {inspectorAuthorship?.path === item.path &&
                  inspectorAuthorship.value
                    ? authorLabel(inspectorAuthorship.value.lastEditedBy)
                    : inspectorAuthorship?.path === item.path &&
                        inspectorAuthorship.error
                      ? '정보를 불러오지 못했습니다'
                      : '기록 불러오는 중…'}
                  {inspectorAuthorship?.path === item.path &&
                    inspectorAuthorship.value?.lastEditedAt && (
                      <small>
                        {new Date(
                          inspectorAuthorship.value.lastEditedAt,
                        ).toLocaleString('ko-KR')}
                      </small>
                    )}
                </dd>
              </dl>
              {doc?.sources.length ? (
                <div className="inspector-sources">
                  <strong>참고한 원본 자료 {doc.sources.length}개</strong>
                  {doc.sources.map((source) => (
                    <button
                      key={source.id}
                      title={source.contribution}
                      onClick={() => focusSource(source.id)}
                    >
                      {documents.find((doc) => doc.id === source.id)?.title ??
                        previews.find(
                          (preview) => preview.sourceId === source.id,
                        )?.title ??
                        source.id}
                      <small>{source.contribution}</small>
                    </button>
                  ))}
                </div>
              ) : null}
              {section && (
                <>
                  <button
                    disabled={locked}
                    onClick={() =>
                      setSectionRename({ section, title: section.title })
                    }
                  >
                    섹션 이름 변경
                  </button>
                  <strong>포함 문서 {section.members.length}개</strong>
                  {section.members.map((member) => (
                    <button key={member.id} onClick={() => jumpTo(member.id)}>
                      {documents.find((doc) => doc.id === member.id)?.title ??
                        member.path}
                    </button>
                  ))}
                </>
              )}
              {!section && (
                <div
                  className="inspector-sources"
                  aria-label="관련 AI 작업 기록"
                >
                  <strong>관련 AI 작업 기록</strong>
                  {inspectorAiRecords?.path !== item.path ||
                  !inspectorAiRecords.entries ? (
                    <small>
                      {inspectorAiRecords?.error
                        ? '기록을 불러오지 못했습니다.'
                        : '기록 불러오는 중…'}
                    </small>
                  ) : (
                    (() => {
                      const entries = relatedAiEntries(
                        inspectorAiRecords.entries,
                        item.path,
                        taskDocuments,
                      );
                      return entries.length ? (
                        <>
                          {entries.slice(0, 3).map((entry) => (
                            <button
                              key={entry.id}
                              onClick={() =>
                                openHistory(item.path, true, entry)
                              }
                            >
                              {entryTaskRecord(entry, taskDocuments)?.title ??
                                entry.label}
                              <small>
                                {new Date(entry.createdAt).toLocaleString(
                                  'ko-KR',
                                )}{' '}
                                · {CODEX_STATUS_LABELS[entry.status]} ·{' '}
                                {entry.actorName ?? '로컬 사용자'}
                              </small>
                            </button>
                          ))}
                          <button onClick={() => openHistory(item.path, true)}>
                            AI 작업 기록 전체 보기 ({entries.length})
                          </button>
                        </>
                      ) : (
                        <small>이 결과와 연결된 AI 실행 기록이 없습니다.</small>
                      );
                    })()
                  )}
                </div>
              )}
              <div className="inspector-actions">
                <button
                  onClick={() => void window.gameCanvas.revealPath(item.path)}
                >
                  <Folder size={14} /> 파일 보기
                </button>
                <button onClick={() => void openHistory(item.path)}>
                  <History size={14} /> 히스토리
                </button>
                {preview && (
                  <button onClick={() => setCompareFirst(preview.relativePath)}>
                    <Columns2 size={14} /> 버전 비교
                  </button>
                )}
              </div>
            </aside>
          );
        })()}
      {uiHidden ? (
        <button
          type="button"
          className="ui-reveal-button floating-surface icon-button"
          onClick={() => setUiHidden(false)}
          title="상단 메뉴 보이기"
        >
          <Eye size={17} />
        </button>
      ) : (
        <header className="floating-header">
          <div className="header-project floating-surface">
            <span className="brand-mark">GC</span>
            <div>
              <strong>{workspace.name ?? 'Game Canvas'}</strong>
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
              onClick={openWorkspace}
              title="다른 프로젝트 열기"
            >
              <FolderOpen size={16} />
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
            <button
              type="button"
              className="collaboration-top-button"
              onClick={() => setCollaborationOpen(true)}
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
              disabled={!hasTaskSelection || aiBusy}
              onClick={() => void createTask()}
              title={
                aiDisabledReason ||
                `선택 자료 · 문서 정리 / HTML 구현 선택 (Ctrl+Enter)`
              }
            >
              <Sparkles size={15} /> <span>gamejam!</span>
            </button>
            <span className="toolbar-divider" />
            <button
              type="button"
              onClick={() => openHistory()}
              title="프로젝트 히스토리"
            >
              <History size={15} />
            </button>
            {aiBusy && (
              <span className="workspace-lock-label">
                AI 작업 중 · 문서 잠금
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
            <button
              type="button"
              className="icon-button"
              onClick={() => setUiHidden(true)}
              title="상단 메뉴 숨기기"
            >
              <EyeOff size={16} />
            </button>
          </div>
        </header>
      )}

      <div
        className="canvas-shell"
        onPointerDownCapture={() => {
          selectionBeforeClick.current = new Set(
            nodes.filter((node) => node.selected).map((node) => node.id),
          );
        }}
        onContextMenu={(event) => {
          if ((event.target as Element).closest('.react-flow__node')) return;
          event.preventDefault();
          openCanvasMenu(event.clientX, event.clientY);
        }}
      >
        <ReactFlow<CanvasNode>
          nodes={nodes}
          edges={[]}
          nodeTypes={nodeTypes}
          onInit={(instance) => {
            flowRef.current = instance;
          }}
          onNodesChange={onNodesChange}
          onNodeClick={(event, node) => {
            if (inspectorId && !event.shiftKey) setInspectorId(node.id);
            setDocumentContextMenu(null);
            setSectionContextMenu(null);
            setPreviewContextMenu(null);
            if (event.shiftKey || event.ctrlKey || event.metaKey) {
              const ids = new Set(selectionBeforeClick.current);
              if (ids.has(node.id)) ids.delete(node.id);
              else ids.add(node.id);
              setNodes((current) =>
                current.map((item) => ({
                  ...item,
                  selected: ids.has(item.id),
                })),
              );
            }
          }}
          onNodeContextMenu={(event, node) => {
            event.preventDefault();
            setContextMenu(null);
            setPreviewContextMenu(null);
            if (node.data.kind === 'document') {
              setSectionContextMenu(null);
              setDocumentContextMenu({
                screenX: Math.min(event.clientX, window.innerWidth - 282),
                screenY: Math.min(event.clientY, window.innerHeight - 190),
                document: node.data.document,
              });
            } else if (node.data.kind === 'section') {
              setDocumentContextMenu(null);
              setSectionContextMenu({
                screenX: Math.min(event.clientX, window.innerWidth - 282),
                screenY: Math.min(event.clientY, window.innerHeight - 230),
                section: node.data.section,
              });
            } else if (node.data.kind === 'preview') {
              setDocumentContextMenu(null);
              setSectionContextMenu(null);
              setPreviewContextMenu({
                screenX: Math.min(event.clientX, window.innerWidth - 282),
                screenY: Math.min(event.clientY, window.innerHeight - 160),
                preview: node.data.preview,
              });
            }
          }}
          onNodeDragStart={() => {
            snapLatest.current = null;
            setGuides({});
          }}
          onNodeDrag={(_event, node, dragged) => {
            if (
              !snapEnabled ||
              _event.altKey ||
              dragged.length > 1 ||
              node.data.kind === 'preview' ||
              locked
            ) {
              snapLatest.current = null;
              setGuides({});
              return;
            }
            const parent = sections.find(
              (section) => node.parentId === sectionNodeId(section.id),
            );
            const x = node.position.x + (parent?.x ?? 0),
              y = node.position.y + (parent?.y ?? 0),
              width = node.measured?.width ?? Number(node.style?.width ?? 300),
              height =
                node.measured?.height ?? Number(node.style?.height ?? 300);
            const excluded =
              node.data.kind === 'section'
                ? new Set(node.data.section.members.map((member) => member.id))
                : new Set<string>();
            const others = nodes
              .filter(
                (other) =>
                  other.id !== node.id &&
                  other.id !== node.parentId &&
                  !other.selected &&
                  !excluded.has(other.id),
              )
              .map((other) => {
                const p = sections.find(
                  (section) => other.parentId === sectionNodeId(section.id),
                );
                return {
                  x: other.position.x + (p?.x ?? 0),
                  y: other.position.y + (p?.y ?? 0),
                  width:
                    other.measured?.width ?? Number(other.style?.width ?? 300),
                  height:
                    other.measured?.height ??
                    Number(other.style?.height ?? 300),
                };
              });
            const snapped = snapPosition(
              { x, y, width, height },
              others,
              6 / (flowRef.current?.getZoom() ?? 1),
            );
            const snappedPosition = {
              x: snapped.x - (parent?.x ?? 0),
              y: snapped.y - (parent?.y ?? 0),
            };
            snapLatest.current = { id: node.id, ...snappedPosition };
            setNodes((current) =>
              current.map((item) =>
                item.id === node.id
                  ? {
                      ...item,
                      position: snappedPosition,
                    }
                  : item,
              ),
            );
            setGuides({ x: snapped.xGuide, y: snapped.yGuide });
          }}
          onNodeDragStop={(_event, node, dragged) => {
            const snap = snapLatest.current;
            const target =
              snap?.id === node.id
                ? { ...node, position: { x: snap.x, y: snap.y } }
                : node;
            const moved = dragged.map((item) =>
              item.id === target.id ? target : item,
            );
            setGuides({});
            snapLatest.current = null;
            void persistDraggedNodes(target, moved);
          }}
          onSelectionChange={({ nodes: selected }) => {
            const nextIds = selected.flatMap((node) =>
              node.data.kind === 'document' ? [node.data.document.id] : [],
            );
            const nextSectionIds = selected.flatMap((node) =>
              node.data.kind === 'section' ? [node.data.section.id] : [],
            );
            setSelectedIds((currentIds) =>
              sameIds(currentIds, nextIds) ? currentIds : nextIds,
            );
            setSelectedSectionIds((currentIds) =>
              sameIds(currentIds, nextSectionIds) ? currentIds : nextSectionIds,
            );
          }}
          onPaneClick={(event) => {
            setContextMenu(null);
            setDocumentContextMenu(null);
            setSectionContextMenu(null);
            setPreviewContextMenu(null);
            if (tool !== 'note') return;
            const point = flowRef.current?.screenToFlowPosition({
              x: event.clientX,
              y: event.clientY,
            });
            if (point) void addIdeaAt(point.x, point.y);
            setTool('select');
          }}
          onPaneContextMenu={(event) => {
            event.preventDefault();
            openCanvasMenu(event.clientX, event.clientY);
          }}
          onMoveStart={() => {
            setContextMenu(null);
            setDocumentContextMenu(null);
            setSectionContextMenu(null);
            setPreviewContextMenu(null);
          }}
          onMove={(_event, viewport) => setViewZoom(viewport.zoom)}
          selectionOnDrag={tool === 'select'}
          panOnDrag={tool === 'hand' ? [0, 1, 2] : [1, 2]}
          nodesDraggable={tool === 'select'}
          elementsSelectable={tool === 'select'}
          multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
          fitView
          minZoom={0.15}
          maxZoom={2}
          deleteKeyCode={null}
        >
          <Background
            color={theme === 'dark' ? '#373b44' : '#c9cdd3'}
            gap={24}
            size={1}
          />
          <Controls position="bottom-left" showInteractive={false} />
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            nodeColor={(node) =>
              node.type === 'preview'
                ? '#20c997'
                : theme === 'dark'
                  ? '#747b87'
                  : '#ffffff'
            }
            maskColor={
              theme === 'dark'
                ? 'rgba(13, 15, 19, 0.72)'
                : 'rgba(238, 240, 243, 0.72)'
            }
          />
        </ReactFlow>
      </div>
      {guides.x !== undefined && (
        <div
          className="snap-guide snap-guide--x"
          style={{
            left: flowRef.current?.flowToScreenPosition({ x: guides.x, y: 0 })
              .x,
          }}
        />
      )}
      {guides.y !== undefined && (
        <div
          className="snap-guide snap-guide--y"
          style={{
            top: flowRef.current?.flowToScreenPosition({ x: 0, y: guides.y }).y,
          }}
        />
      )}
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
            void flowRef.current?.fitView({ padding: 0.16, duration: 250 })
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
          <span>
            {selectedSections.length
              ? `섹션 ${selectedSections.length}개 · 실제 문서 ${inputSelection.length}개`
              : selectedDocuments.length
                ? `문서 ${selectedDocuments.length}개 선택`
                : 'HTML 결과 선택'}
          </span>
          <button
            title="선택 항목 상세 정보"
            onClick={() =>
              setInspectorId(nodes.find((node) => node.selected)!.id)
            }
          >
            <Info size={14} />
          </button>
          <button
            title="선택 항목 최소화 또는 펼치기 (Ctrl+Shift+M)"
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
              <button
                disabled={locked}
                title="선택 문서 삭제 (Delete)"
                onClick={requestDelete}
              >
                <Trash2 size={14} />
              </button>
            </>
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
                      locked ||
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
        </button>
        <button
          type="button"
          className={tool === 'note' ? 'active' : ''}
          aria-pressed={tool === 'note'}
          disabled={locked}
          onClick={() => setTool('note')}
          title="메모 도구 (N) — 선택 후 빈 곳 클릭"
        >
          <StickyNote size={19} />
          <span>메모 배치</span>
        </button>
        <span className="toolbar-divider toolbar-divider--vertical" />
        <button
          type="button"
          onClick={() => void addIdeaNearCenter()}
          disabled={locked}
          title="화면 중앙에 새 메모 만들기"
        >
          <Plus size={19} />
          <span>새 메모</span>
        </button>
        <button
          type="button"
          onClick={() => openImport()}
          disabled={locked || importingFiles}
          title="Markdown · HTML 게임 · 이미지 파일 불러오기 (Ctrl+I)"
        >
          <Upload size={19} />
          <span>불러오기</span>
        </button>
        <button
          type="button"
          disabled={selectedDocuments.length === 0 || locked}
          onClick={() => {
            setSectionTitle('새 섹션');
            setSectionDialogOpen(true);
          }}
          title="선택한 파일을 하나의 섹션으로 묶기"
        >
          <Frame size={19} />
          <span>섹션</span>
        </button>
      </nav>

      {codexRun && (
        <aside
          className={`codex-run-panel floating-surface${codexRunCollapsed ? ' codex-run-panel--collapsed' : ''}`}
          aria-live="polite"
        >
          <header>
            <div className="codex-run-panel__title">
              {codexRun.status === 'starting' ||
              codexRun.status === 'running' ||
              codexRun.status === 'validating' ? (
                <LoaderCircle className="spin" size={16} />
              ) : codexRun.status === 'completed' ? (
                <CheckCircle2 size={16} />
              ) : (
                <AlertCircle size={16} />
              )}
              <div>
                <strong>{getAiProvider(codexRun.providerId).label} 작업</strong>
                <span>
                  {CODEX_STATUS_LABELS[codexRun.status]} ·{' '}
                  {getAiModelLabel(codexRun.providerId, codexRun.modelId)}
                </span>
              </div>
            </div>
            <div className="codex-run-panel__header-actions">
              <button
                type="button"
                className="icon-button"
                title="AI 작업 기록 열기"
                onClick={() => openHistory(codexRun.taskPath, true)}
              >
                <History size={14} />
              </button>
              {codexRun.status === 'completed' && (
                <button
                  title="생성 결과로 이동"
                  onClick={() => {
                    const paths = runOutputPaths;
                    const result = previews
                      .filter((preview) => paths.includes(preview.relativePath))
                      .at(-1);
                    if (result) jumpTo(previewNodeId(result.relativePath));
                    else {
                      const ids = documents
                        .filter((doc) => paths.includes(doc.relativePath))
                        .map((doc) => ({ id: doc.id }));
                      if (ids.length)
                        void flowRef.current?.fitView({
                          nodes: ids,
                          padding: 0.2,
                          duration: 300,
                        });
                      else setNavigatorOpen(true);
                    }
                  }}
                >
                  <Play size={13} /> 결과 보기
                </button>
              )}
              {(codexRun.status === 'starting' ||
                codexRun.status === 'running' ||
                codexRun.status === 'validating') && (
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => void cancelCodexRun()}
                  disabled={cancellingCodexRun || !canStopAi}
                  title="현재 AI 작업 중지"
                >
                  {cancellingCodexRun ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <Square size={13} />
                  )}
                </button>
              )}
              <button
                type="button"
                className="icon-button"
                onClick={() => {
                  if (codexRunCollapsed) {
                    setInspectorId(null);
                    setSettingsOpen(false);
                    setHistoryOpen(false);
                  }
                  setCodexRunCollapsed((current) => !current);
                }}
                title={
                  codexRunCollapsed ? '작업 패널 펼치기' : '작업 패널 최소화'
                }
              >
                {codexRunCollapsed ? (
                  <Maximize2 size={14} />
                ) : (
                  <Minimize2 size={14} />
                )}
              </button>
              {codexRun.status !== 'starting' &&
                codexRun.status !== 'running' &&
                codexRun.status !== 'validating' && (
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setCodexRun(null)}
                    title="실행 패널 닫기"
                  >
                    <X size={14} />
                  </button>
                )}
            </div>
          </header>
          {!codexRunCollapsed && (
            <>
              <ol className="ai-stages" aria-label="AI 진행 단계">
                {[
                  ['starting', '준비'],
                  ['running', '실행'],
                  ['validating', '검증'],
                  ['completed', '완료'],
                ].map(([status, label], index) => (
                  <li
                    key={status}
                    className={
                      codexRun.status === status
                        ? 'is-current'
                        : [
                              'starting',
                              'running',
                              'validating',
                              'completed',
                            ].indexOf(codexRun.status) > index
                          ? 'is-done'
                          : ''
                    }
                  >
                    <span>{index + 1}</span>
                    {label}
                  </li>
                ))}
              </ol>
              <code className="codex-run-panel__task">{codexRun.taskPath}</code>
              {runFailure && (
                <section
                  className="ai-failure-details"
                  aria-label="AI 오류 진단"
                >
                  <strong>
                    {runFailure.code} · {runFailure.stage}
                  </strong>
                  <p>{runFailure.message}</p>
                  <p>{runFailure.hint}</p>
                  <small>실행 ID: {codexRun.runId}</small>
                  <div>
                    <button
                      onClick={() => {
                        void window.gameCanvas
                          .copyText(
                            JSON.stringify(
                              {
                                runId: codexRun.runId,
                                taskPath: codexRun.taskPath,
                                provider: codexRun.providerId,
                                model: codexRun.modelId,
                                ...runFailure,
                              },
                              null,
                              2,
                            ),
                          )
                          .then(() =>
                            setNotice('오류 진단 정보를 복사했습니다.'),
                          )
                          .catch(showError);
                      }}
                    >
                      진단 정보 복사
                    </button>
                    {runFailure.diagnosticPath && (
                      <button
                        onClick={() => {
                          void window.gameCanvas
                            .revealPath(runFailure.diagnosticPath!)
                            .catch(showError);
                        }}
                      >
                        진단 파일 보기
                      </button>
                    )}
                  </div>
                </section>
              )}
              <div
                ref={codexLogsRef}
                className="codex-run-panel__logs nowheel"
                role="log"
                aria-label="AI 작업 진행 로그"
              >
                {codexRun.events.length === 0 ? (
                  <p>AI 프로세스의 응답을 기다리고 있습니다.</p>
                ) : (
                  codexRun.events.map((event, index) => (
                    <p
                      key={`${event.timestamp}-${index}`}
                      className={`codex-log codex-log--${event.kind}`}
                    >
                      <time>
                        {new Date(event.timestamp).toLocaleTimeString('ko-KR', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </time>
                      <span>{event.message}</span>
                    </p>
                  ))
                )}
              </div>
              {(codexRun.status === 'starting' ||
                codexRun.status === 'running' ||
                codexRun.status === 'validating') && (
                <footer>
                  <span>
                    새 로그가 추가되면 자동으로 최신 위치를 표시합니다.
                  </span>
                  <button
                    type="button"
                    onClick={() => void cancelCodexRun()}
                    disabled={cancellingCodexRun || !canStopAi}
                  >
                    {cancellingCodexRun ? (
                      <LoaderCircle className="spin" size={13} />
                    ) : (
                      <Square size={13} />
                    )}{' '}
                    {cancellingCodexRun ? '중지 중' : '작업 중지'}
                  </button>
                </footer>
              )}
            </>
          )}
        </aside>
      )}

      {completion &&
        codexRun?.runId === completion.runId &&
        codexRunCollapsed && (
          <section
            className={`ai-completion-toast floating-surface${completion.status === 'failed' ? ' ai-completion-toast--failed' : ''}`}
            role="status"
            aria-live="polite"
            aria-label="AI 작업 완료 알림"
          >
            <button
              className="icon-button ai-completion-toast__close"
              title="완료 알림 닫기"
              onClick={() => setCompletion(null)}
            >
              <X size={14} />
            </button>
            <strong>
              {completion.status === 'completed' ? (
                <>
                  <CheckCircle2 size={18} /> 완료!
                </>
              ) : (
                <>
                  <AlertCircle size={18} /> 작업 실패 ·{' '}
                  {runFailure?.code ?? '진단 확인'}
                </>
              )}
            </strong>
            <p>
              {completion.status === 'completed'
                ? `${completion.taskPath.includes('/gamejam-') ? '문서 정리 + HTML 구현' : completion.taskPath.includes('/organize-') ? '문서 정리' : 'HTML 구현'} 결과를 검증하고 저장했습니다.`
                : '기존 결과는 유지했습니다. 오류 진단을 확인해주세요.'}
            </p>
            <div>
              <button
                onClick={() => {
                  setCodexRunCollapsed(false);
                  setInspectorId(null);
                  setHistoryOpen(false);
                  setSettingsOpen(false);
                }}
              >
                {completion.status === 'completed'
                  ? '작업 내용 보기'
                  : '오류 진단 보기'}
              </button>
              {completion.status === 'completed' && (
                <button
                  onClick={() => {
                    const ids = nodes
                      .filter((node) =>
                        node.data.kind === 'document'
                          ? runOutputPaths.includes(
                              node.data.document.relativePath,
                            )
                          : node.data.kind === 'preview'
                            ? runOutputPaths.includes(
                                node.data.preview.relativePath,
                              )
                            : false,
                      )
                      .map((node) => ({ id: node.id }));
                    if (ids.length)
                      void flowRef.current?.fitView({
                        nodes: ids,
                        padding: 0.2,
                        duration: 300,
                      });
                    else setNavigatorOpen(true);
                  }}
                >
                  결과로 이동
                </button>
              )}
            </div>
          </section>
        )}
      {blockedMessage && (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="section-dialog floating-surface"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="locked-dialog-title"
          >
            <h2 id="locked-dialog-title">문서 편집 안내</h2>
            <p>{blockedMessage}</p>
            <div className="section-dialog__actions">
              <button
                type="button"
                className="button-primary"
                autoFocus
                onClick={() => setBlockedMessage(null)}
              >
                확인
              </button>
            </div>
          </section>
        </div>
      )}

      {historyOpen && (
        <aside
          className={`history-panel floating-surface${aiHistorySelection || historySelection ? ' history-panel--has-detail' : ''}`}
          aria-label="프로젝트 히스토리"
        >
          <header>
            <strong>
              {historyFilter
                ? `${historyFilter} 히스토리`
                : '프로젝트 히스토리'}
            </strong>
            <button
              type="button"
              className="icon-button"
              title="히스토리 닫기"
              onClick={() => {
                historyRequest.current += 1;
                setHistoryOpen(false);
              }}
            >
              <X size={16} />
            </button>
          </header>
          <div
            className="history-tabs"
            role="group"
            aria-label="히스토리 보기 방식"
          >
            <button
              aria-pressed={!historyAiOnly}
              onClick={() => {
                setHistoryAiOnly(false);
                setAiHistorySelection(null);
                setHistorySelection(null);
                historyRequest.current++;
              }}
            >
              전체 히스토리
            </button>
            <button
              aria-pressed={historyAiOnly}
              onClick={() => {
                setHistoryAiOnly(true);
                setAiHistorySelection(null);
                setHistorySelection(null);
                historyRequest.current++;
              }}
            >
              AI 작업 기록
            </button>
          </div>
          <div className="history-panel__body">
            <div className="history-panel__entries">
              {filteredHistoryEntries.map((entry) => (
                <div
                  className="history-entry"
                  data-history-kind={entry.kind}
                  key={entry.id}
                >
                  <strong>{entry.label}</strong>
                  <small>
                    {new Date(entry.createdAt).toLocaleString()} ·{' '}
                    {CODEX_STATUS_LABELS[entry.status]}
                    {entry.modelId ? ` · ${entry.modelId}` : ''}
                    {` · ${entry.actorName ?? '로컬 사용자'}`}
                  </small>
                  {entry.error && (
                    <p className="history-error">{entry.error}</p>
                  )}
                  {(historyTaskPath(entry) || entry.kind === 'ai') && (
                    <button
                      type="button"
                      className="history-ai-record-button"
                      aria-pressed={aiHistorySelection?.id === entry.id}
                      onClick={() => {
                        historyRequest.current++;
                        setHistorySelection(null);
                        setAiHistorySelection(entry);
                      }}
                    >
                      <Bot size={13} /> 작업 지시 · 실행 상세 보기
                    </button>
                  )}
                  {entry.files
                    .filter((file) => !isAiTaskPath(file.relativePath))
                    .map((file) => (
                      <button
                        type="button"
                        key={file.relativePath}
                        onClick={() => {
                          const target = documents.find(
                            (document) =>
                              document.relativePath === file.relativePath,
                          );
                          if (target) focusSource(target.id);
                          void inspectHistory(
                            entry,
                            file.relativePath,
                            file.after ? 'after' : 'before',
                          );
                        }}
                      >
                        {file.after ? (file.before ? '수정' : '생성') : '삭제'}{' '}
                        · {file.relativePath}
                      </button>
                    ))}
                  {entry.status === 'completed' &&
                    entry.files.some(
                      (file) => !isAiTaskPath(file.relativePath),
                    ) && (
                      <button
                        type="button"
                        disabled={restoring || !canRestoreHistory}
                        onClick={() => {
                          if (locked) onBlocked();
                          else setHistoryConfirm({ entry });
                        }}
                      >
                        이 기록의 파일 함께 복원
                      </button>
                    )}
                </div>
              ))}
              {!filteredHistoryEntries.length && (
                <p>
                  {historyAiOnly
                    ? '아직 연결된 AI 작업 기록이 없습니다.'
                    : '아직 저장된 버전이 없습니다.'}
                </p>
              )}
            </div>
            {aiHistorySelection && (
              <div className="history-preview">
                <AiTaskDetails
                  entry={aiHistorySelection}
                  record={entryTaskRecord(aiHistorySelection, taskDocuments)}
                  statusLabel={CODEX_STATUS_LABELS[aiHistorySelection.status]}
                  onOpenPath={focusResultPath}
                />
              </div>
            )}
            {historySelection && (
              <div className="history-preview">
                <strong>{historySelection.path}</strong>
                <div className="history-preview__actions">
                  <button
                    type="button"
                    onClick={() =>
                      void inspectHistory(
                        historySelection.entry,
                        historySelection.path,
                        'before',
                      )
                    }
                  >
                    변경 전
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void inspectHistory(
                        historySelection.entry,
                        historySelection.path,
                        'after',
                      )
                    }
                  >
                    변경 후
                  </button>
                  {!historySelection.entry.files.some(
                    (file) =>
                      file.relativePath.startsWith('sections/') ||
                      file.relativePath.startsWith('assets/images/'),
                  ) &&
                    historySelection.entry.status === 'completed' && (
                      <button
                        type="button"
                        disabled={restoring || !canRestoreHistory}
                        onClick={() => {
                          if (locked) onBlocked();
                          else
                            setHistoryConfirm({
                              entry: historySelection.entry,
                              path: historySelection.path,
                              version: historySelection.version,
                            });
                        }}
                      >
                        이 파일 버전 복원
                      </button>
                    )}
                </div>
                <small>
                  {historySelection.version === 'before'
                    ? '변경 전 내용'
                    : '변경 후 내용'}{' '}
                  · 파일 복원은 지금 보고 있는 버전을 사용합니다.
                </small>
                {historySelection.content === null ? (
                  <p>이 시점에는 파일이 없습니다.</p>
                ) : historySelection.path.startsWith('assets/images/') ? (
                  <img
                    className="project-image"
                    src={historySelection.content}
                    alt="이전 이미지 원본"
                  />
                ) : historySelection.path.endsWith('.html') ? (
                  <iframe
                    title="이전 HTML 결과"
                    sandbox="allow-scripts"
                    srcDoc={historySelection.content}
                  />
                ) : (
                  <pre>{historySelection.content}</pre>
                )}
              </div>
            )}
          </div>
        </aside>
      )}
      {historyConfirm && (
        <div className="dialog-backdrop">
          <section
            className="section-dialog floating-surface"
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-dialog-title"
          >
            <h2 id="restore-dialog-title">이 버전을 복원할까요?</h2>
            <p>
              {historyConfirm.path ?? historyConfirm.entry.label}의 저장 버전을
              복원합니다. 현재 내용은 새 기록으로 보관되며, 삭제 기록은 삭제 전
              상태로 복원됩니다.
            </p>
            <div className="section-dialog__actions">
              <button
                type="button"
                disabled={restoring}
                onClick={() => setHistoryConfirm(null)}
              >
                취소
              </button>
              <button
                type="button"
                className="button-primary"
                disabled={restoring}
                onClick={() => void restoreSelectedHistory()}
              >
                {restoring ? '복원 중' : '복원'}
              </button>
            </div>
          </section>
        </div>
      )}

      {previewContextMenu && (
        <div
          className="canvas-context-menu document-context-menu floating-surface"
          style={{
            left: previewContextMenu.screenX,
            top: previewContextMenu.screenY,
          }}
          role="menu"
          aria-label="HTML 결과 메뉴"
        >
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
              void window.gameCanvas.revealPath(relativePath).catch(showError);
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
        </div>
      )}

      {documentContextMenu && (
        <div
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
            disabled={
              documentContextMenu.document.relativePath === 'project.md'
            }
            onClick={() => {
              if (locked) {
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
              <small>
                {documentContextMenu.document.relativePath === 'project.md'
                  ? '프로젝트 기본 문서는 삭제할 수 없음'
                  : '확인 후 Windows 휴지통으로 이동'}
              </small>
            </span>
          </button>
        </div>
      )}

      {sectionContextMenu && (
        <div
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

      {contextMenu && (
        <div
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
            onClick={() => {
              void window.gameCanvas.openWorkspace();
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

      {importTarget && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !importingFiles)
              setImportTarget(null);
          }}
        >
          <section
            className="import-dialog floating-surface"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-title"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !importingFiles) {
                event.stopPropagation();
                setImportTarget(null);
              }
            }}
          >
            <header>
              <h2 id="import-title">
                <Upload size={20} /> 파일 불러오기
              </h2>
              <button
                className="icon-button"
                title="파일 불러오기 닫기"
                disabled={importingFiles}
                onClick={() => setImportTarget(null)}
              >
                <X size={18} />
              </button>
            </header>
            <p>
              MD 문서는 참고 문서로, HTML 게임은 실행창으로, 이미지는 카드로
              추가합니다. 여러 파일을 함께 선택할 수 있으며 원본 파일은 변경하지
              않습니다.
            </p>
            <label>
              불러올 이미지 용도
              <select
                aria-label="불러올 이미지 용도"
                value={imagePurpose}
                onChange={(event) =>
                  setImagePurpose(event.target.value as 'asset' | 'diagram')
                }
                disabled={importingFiles}
              >
                <option value="asset">게임 에셋</option>
                <option value="diagram">게임 구조·시스템 설명 도식</option>
              </select>
            </label>
            <small>
              MD 최대 2MB · HTML/HTM 최대 8MB · PNG/JPG/WebP/GIF 최대 5MB · 한
              번에 20개 / 원본 합계 12MB. SVG는 지원하지 않습니다. Markdown의
              외부 이미지와 상대경로 첨부는 자동으로 가져오지 않습니다.
            </small>
            <small>
              HTML은 CSS·JavaScript가 내부에 포함된 단일 파일을 권장합니다. 별도
              이미지·JS·CSS 파일이나 폴더는 함께 가져오지 않습니다. 신뢰하는
              게임 파일만 불러오세요.
            </small>
            <small>
              공동 작업에서는 서버 사본에 공유됩니다. AI 작업 중에는 불러오기가
              잠기며 뷰어는 파일을 추가할 수 없습니다.
            </small>
            {importError && (
              <p className="collaboration-error" role="alert">
                {importError}
              </p>
            )}
            <div className="import-dialog-actions">
              <button
                disabled={importingFiles}
                onClick={() => setImportTarget(null)}
              >
                취소
              </button>
              <button
                className="button-primary"
                disabled={importingFiles || locked}
                onClick={() => void importFiles()}
              >
                {importingFiles ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <FolderOpen size={15} />
                )}{' '}
                파일 선택해서 불러오기
              </button>
            </div>
          </section>
        </div>
      )}
      {codexStatusOpen && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCodexStatusOpen(false);
          }}
        >
          <section
            className="codex-dialog floating-surface"
            role="dialog"
            aria-modal="true"
            aria-labelledby="codex-status-title"
          >
            <div className="codex-dialog__icon">
              <Bot size={20} />
            </div>
            <div>
              <p>LOCAL AI CONNECTION</p>
              <h2 id="codex-status-title">내 AI 연결</h2>
              <span>
                실행하는 사람의 PC에 설치된 CLI와 본인 로그인 정보를 사용합니다.
                웹사이트나 일반 채팅 앱에 로그인한 것만으로 연결되지는 않습니다.
                계정별 사용량·요금 정책이 적용됩니다.
              </span>
              <label>
                AI 제공자{' '}
                <select
                  aria-label="연결할 AI 제공자"
                  value={selectedAiProvider}
                  onChange={(event) => {
                    setCodexStatus(null);
                    setSelectedAiProvider(event.target.value as AiProviderId);
                    setSelectedAiModel('');
                  }}
                >
                  {AI_PROVIDERS.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </label>
              <p>{getAiProvider(selectedAiProvider).description}</p>
              <p>
                설치: <code>{getAiProvider(selectedAiProvider).install}</code>
              </p>
              <p>
                로그인: <code>{getAiProvider(selectedAiProvider).login}</code>
              </p>
            </div>
            <div className="codex-status-card">
              <div>
                <span
                  className={`codex-connection-dot ${
                    codexStatus?.available && codexStatus.authenticated
                      ? 'connected'
                      : 'disconnected'
                  }`}
                />
                <strong>
                  {checkingCodex
                    ? '연결 확인 중'
                    : codexStatus?.available && codexStatus.authenticated
                      ? '사용 가능'
                      : '연결 필요'}
                </strong>
              </div>
              <p>
                {codexStatus?.message ?? '선택한 AI CLI를 확인하고 있습니다.'}
              </p>
              {codexStatus?.version && <code>{codexStatus.version}</code>}
              {codexStatus?.executablePath && (
                <code>{codexStatus.executablePath}</code>
              )}
            </div>
            <div className="codex-dialog__scope">
              <strong>현재 실행 정책</strong>
              <span>
                {selectedAiProvider === 'codex-cli'
                  ? '격리 작업 사본 · 외부 MCP 제외 · Codex 자동 검토'
                  : '격리 작업 사본 · 파일 도구만 허용 · 셸·브라우저·MCP 제외'}{' '}
                · 결과 검증 후 반영
              </span>
            </div>
            <div className="codex-dialog__actions">
              <button
                type="button"
                onClick={() => void refreshCodexStatus()}
                disabled={checkingCodex}
              >
                <RefreshCw size={14} /> 다시 확인
              </button>
              <button
                type="button"
                className="button-primary"
                onClick={() => setCodexStatusOpen(false)}
              >
                확인
              </button>
            </div>
          </section>
        </div>
      )}

      {aiRequest && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !creatingTask)
              setAiRequest(null);
          }}
        >
          <section
            className={`ai-request-dialog floating-surface${aiRequest.organize && aiRequest.implement ? ' ai-request-dialog--combined' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-request-title"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !creatingTask) {
                event.stopPropagation();
                setAiRequest(null);
              }
            }}
          >
            <header>
              <div>
                <span className="eyebrow">IDEA → DOCUMENT → PLAY</span>
                <h2 id="ai-request-title">gamejam!</h2>
              </div>
              <button
                className="icon-button"
                title="AI 실행창 닫기"
                disabled={creatingTask}
                onClick={() => setAiRequest(null)}
              >
                <X size={18} />
              </button>
            </header>
            <div className="ai-request-fields">
              <p>
                선택 범위를 확인하고 실행하세요. 실행 전 편집 내용을 저장하며,
                작업 중에는 문서 변경이 잠깁니다.
              </p>
              <h3 className="ai-step-heading">
                <span>1</span> 무엇을 만들까요?
              </h3>
              <div
                className="gamejam-steps"
                role="group"
                aria-label="실행할 작업 선택"
              >
                <label className={aiRequest.organize ? 'selected' : ''}>
                  <input
                    type="checkbox"
                    checked={aiRequest.organize}
                    disabled={creatingTask}
                    onChange={(event) =>
                      setAiRequest({
                        ...aiRequest,
                        organize: event.target.checked,
                      })
                    }
                  />
                  <Sparkles size={18} />
                  <span>
                    <strong>문서 정리</strong>
                    <small>
                      {aiRequest.sourceMode === 'html'
                        ? '선택한 HTML 게임을 분석해 Markdown 추출'
                        : '선택 메모를 Markdown 문서로 정리'}
                    </small>
                  </span>
                </label>
                <label className={aiRequest.implement ? 'selected' : ''}>
                  <input
                    type="checkbox"
                    checked={aiRequest.implement}
                    disabled={creatingTask}
                    onChange={(event) =>
                      setAiRequest({
                        ...aiRequest,
                        implement: event.target.checked,
                      })
                    }
                  />
                  <Code2 size={18} />
                  <span>
                    <strong>HTML 구현</strong>
                    <small>실행 가능한 게임 프로토타입 생성</small>
                  </span>
                </label>
              </div>
              <p className="gamejam-flow-summary" role="status">
                {aiRequest.organize && aiRequest.implement
                  ? '1. 문서 정리 및 검증 → 2. 이번에 정리한 문서로 HTML 구현 → 전체 결과 반영'
                  : aiRequest.organize
                    ? aiRequest.sourceMode === 'html'
                      ? 'HTML 코드 분석 → 게임 개요·핵심 플레이 흐름·확인 필요 사항 추출. 원본 HTML은 변경하지 않습니다.'
                      : '선택한 메모·파일을 문서로 정리합니다.'
                    : aiRequest.implement
                      ? '선택한 문서를 기반으로 HTML을 구현합니다.'
                      : '실행할 작업을 하나 이상 선택해주세요.'}
              </p>
              {aiRequest.implement && (
                <small>
                  새 HTML은 게임 이름·버전별 전용 폴더에 저장합니다. 결과 폴더만
                  복사해도 실행할 수 있습니다. 기존 결과 업데이트는 원래 위치를
                  유지합니다.
                </small>
              )}
              {aiRequest.implement &&
                collaboration.active &&
                !collaboration.htmlResultFolders && (
                  <p role="alert">
                    HTML 결과 폴더를 사용하려면 협업 서버를 v0.8.1 이상으로
                    업데이트하고 다시 시작해주세요.
                  </p>
                )}
              {aiRequest.sourceMode === 'html' && (
                <small>
                  코드에서 확인한 구현, AI의 추정, 확인 불가를 구분합니다. 자동
                  플레이 분석은 하지 않습니다. 구현까지 선택하면 추출 문서를
                  기반으로 새 결과를 만듭니다.
                </small>
              )}
              {aiRequest.sourceMode === 'html' &&
                collaboration.active &&
                !collaboration.htmlImportAnalysis && (
                  <p role="alert">
                    HTML 분석에는 협업 서버 v0.7.10 이상이 필요합니다. 서버를
                    업데이트해주세요.
                  </p>
                )}
              {aiRequest.sourceMode === 'html' &&
                aiRequest.implement &&
                aiRequest.htmlResult?.mode === 'update' &&
                aiRequest.inputPaths.includes(
                  aiRequest.htmlResult.basePath ?? 'output/index.html',
                ) && (
                  <p role="alert">
                    분석 대상 원본 HTML은 덮어쓸 수 없습니다. 새 버전을
                    선택하거나 다른 결과를 업데이트해주세요.
                  </p>
                )}
              {collaboration.active &&
                aiRequest.organize &&
                aiRequest.implement &&
                !collaboration.gamejamWorkflow && (
                  <p role="alert">
                    연속 실행은 협업 서버 v0.7.9 이상이 필요합니다. 서버를
                    업데이트하거나 한 단계만 선택해주세요.
                  </p>
                )}
              <details open className="ai-input-scope">
                <summary>
                  입력 범위 · 문서{' '}
                  {
                    aiRequest.inputPaths.filter(
                      (path) => !path.startsWith('sections/'),
                    ).length
                  }
                  개 · 섹션{' '}
                  {
                    aiRequest.inputPaths.filter((path) =>
                      path.startsWith('sections/'),
                    ).length
                  }
                  개
                </summary>
                <div>
                  {aiRequest.inputPaths.map((path) => (
                    <button
                      key={path}
                      type="button"
                      onClick={() => {
                        const item = canvasItems.find(
                          (item) => item.path === path,
                        );
                        if (item) jumpTo(item.id);
                      }}
                    >
                      <FileText size={14} />
                      <span>
                        {documents.find((doc) => doc.relativePath === path)
                          ?.title ??
                          previews.find(
                            (preview) => preview.relativePath === path,
                          )?.title ??
                          sections.find(
                            (section) => section.relativePath === path,
                          )?.title ??
                          path}
                      </span>
                      <small>
                        {path.startsWith('sections/')
                          ? '섹션'
                          : path.endsWith('.html')
                            ? 'HTML 게임'
                            : '문서'}
                      </small>
                    </button>
                  ))}
                </div>
              </details>
              <h3 className="ai-step-heading">
                <span>2</span> 결과물 설정
              </h3>
              {aiRequest.organize && (
                <>
                  <div
                    className="ai-output-choices"
                    role="group"
                    aria-label="정리 문서 생성 방식"
                  >
                    <button
                      aria-pressed={aiRequest.documentResult?.mode === 'new'}
                      disabled={creatingTask}
                      onClick={() =>
                        setAiRequest({
                          ...aiRequest,
                          documentResult: { mode: 'new' },
                        })
                      }
                    >
                      <Plus size={17} />
                      <strong>새 문서 버전 만들기</strong>
                      <small>기존 문서 유지 · 새 Markdown 묶음</small>
                    </button>
                    <button
                      aria-pressed={aiRequest.documentResult?.mode === 'update'}
                      disabled={creatingTask || !organizedSets.length}
                      onClick={() =>
                        setAiRequest({
                          ...aiRequest,
                          documentResult: {
                            mode: 'update',
                            baseDir: organizedSets.at(-1)?.baseDir,
                          },
                        })
                      }
                    >
                      <RefreshCw size={17} />
                      <strong>기존 문서 업데이트</strong>
                      <small>선택 묶음 갱신 · 이전 내용은 히스토리</small>
                    </button>
                  </div>
                  {aiRequest.documentResult?.mode === 'update' ? (
                    <label>
                      업데이트할 문서 묶음
                      <select
                        aria-label="업데이트할 문서 묶음"
                        value={aiRequest.documentResult.baseDir}
                        disabled={creatingTask}
                        onChange={(event) =>
                          setAiRequest({
                            ...aiRequest,
                            documentResult: {
                              mode: 'update',
                              baseDir: event.target.value,
                            },
                          })
                        }
                      >
                        {organizedSets.map((set) => (
                          <option key={set.baseDir} value={set.baseDir}>
                            {set.label} · {set.baseDir}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <p className="ai-output-hint">
                      새 .md 파일 3개를 생성합니다. 기존 정리 문서를 덮어쓰지
                      않습니다.
                    </p>
                  )}
                </>
              )}
              {aiRequest.implement && previews.length > 0 && (
                <>
                  <div
                    className="ai-output-choices"
                    role="group"
                    aria-label="HTML 결과 생성 방식"
                  >
                    <button
                      aria-pressed={aiRequest.htmlResult?.mode === 'new'}
                      disabled={creatingTask}
                      onClick={() =>
                        setAiRequest({
                          ...aiRequest,
                          htmlResult: { ...aiRequest.htmlResult, mode: 'new' },
                        })
                      }
                    >
                      <Plus size={17} />
                      <strong>새 버전 만들기</strong>
                      <small>기존 결과 유지 · 새 파일과 창</small>
                    </button>
                    <button
                      aria-pressed={aiRequest.htmlResult?.mode === 'update'}
                      disabled={creatingTask}
                      onClick={() =>
                        setAiRequest({
                          ...aiRequest,
                          htmlResult: {
                            ...aiRequest.htmlResult,
                            mode: 'update',
                            basePath:
                              aiRequest.htmlResult?.basePath ??
                              previews.at(-1)!.relativePath,
                          },
                        })
                      }
                    >
                      <RefreshCw size={17} />
                      <strong>기존 결과 업데이트</strong>
                      <small>선택 결과 갱신 · 이전 내용은 히스토리</small>
                    </button>
                  </div>
                  <label>
                    {aiRequest.htmlResult?.mode === 'update'
                      ? '업데이트할 결과'
                      : '새 버전의 기준 결과'}
                    <select
                      aria-label="기준 HTML 결과"
                      value={aiRequest.htmlResult?.basePath ?? ''}
                      disabled={creatingTask}
                      onChange={(event) =>
                        setAiRequest({
                          ...aiRequest,
                          htmlResult: {
                            mode: aiRequest.htmlResult?.mode ?? 'new',
                            basePath: event.target.value || undefined,
                          },
                        })
                      }
                    >
                      {aiRequest.htmlResult?.mode !== 'update' && (
                        <option value="">
                          기준 없음 · 선택 문서로 새 게임 만들기
                        </option>
                      )}
                      {previews.map((preview) => (
                        <option
                          value={preview.relativePath}
                          key={preview.relativePath}
                        >
                          {preview.title ? `${preview.title} · ` : ''}
                          {previewLabel(preview.relativePath)} ·{' '}
                          {preview.relativePath}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <section className="ai-instructions-field">
                <label htmlFor="ai-result-name">
                  {aiRequest.implement
                    ? aiRequest.organize
                      ? '프로토타입 이름 · 문서에도 적용'
                      : '게임 이름'
                    : '문서 묶음 이름'}
                </label>
                <input
                  id="ai-result-name"
                  value={aiRequest.resultName}
                  maxLength={MAX_RESULT_NAME}
                  disabled={creatingTask}
                  placeholder={
                    aiRequest.implement
                      ? '예: 한밤의 카페'
                      : '예: 플레이어 시스템'
                  }
                  onChange={(event) =>
                    setAiRequest({
                      ...aiRequest,
                      resultName: event.target.value,
                    })
                  }
                />
                <small>
                  새 버전은 이름을 실제 파일명에 반영합니다(공백은 하이픈으로
                  변환). 기존 파일 업데이트는 경로를 유지하고 제목에 반영합니다.
                  비워두면 기존 기본 이름을 사용합니다.
                  {aiRequest.organize &&
                    ' 문서 정리는 게임 개요·핵심 루프·미결정 사항 3개 파일을 생성합니다.'}
                </small>
                {resultNameError && <p role="alert">{resultNameError}</p>}
                {collaboration.active &&
                  !!aiRequest.resultName.trim() &&
                  !collaboration.taskResultNaming && (
                    <p role="alert">
                      결과 이름을 사용하려면 협업 서버를 v0.7.7 이상으로
                      업데이트해주세요.
                    </p>
                  )}
                {collaboration.active &&
                  !collaboration.taskInstructionsEditable && (
                    <p role="alert">
                      작업 지시를 사용하려면 협업 서버를 v0.7.5 이상으로
                      업데이트해야 합니다.
                    </p>
                  )}
                <h3 className="ai-step-heading">
                  <span>3</span> 작업 지침
                </h3>
                {(['organize', 'implement'] as const)
                  .filter((kind) => aiRequest[kind])
                  .map((kind) => (
                    <div className="gamejam-instructions" key={kind}>
                      <div className="ai-instructions-heading">
                        <label htmlFor={`ai-task-instructions-${kind}`}>
                          {kind === 'organize'
                            ? '문서 정리 지시'
                            : 'HTML 구현 지시'}
                        </label>
                        <button
                          type="button"
                          disabled={
                            creatingTask ||
                            aiRequest.instructions[kind] ===
                              defaultTaskInstructions(
                                kind,
                                aiRequest.sourceMode,
                              )
                          }
                          title="입력한 내용을 기본 작업 지시로 대체합니다"
                          onClick={() =>
                            setAiRequest({
                              ...aiRequest,
                              instructions: {
                                ...aiRequest.instructions,
                                [kind]: defaultTaskInstructions(
                                  kind,
                                  aiRequest.sourceMode,
                                ),
                              },
                            })
                          }
                        >
                          <RefreshCw size={13} /> 기본값으로 복원
                        </button>
                      </div>
                      <textarea
                        id={`ai-task-instructions-${kind}`}
                        aria-describedby={`ai-instructions-help-${kind}`}
                        value={aiRequest.instructions[kind]}
                        disabled={creatingTask}
                        maxLength={MAX_TASK_INSTRUCTIONS}
                        rows={
                          aiRequest.organize && aiRequest.implement ? 7 : 10
                        }
                        onChange={(event) =>
                          setAiRequest({
                            ...aiRequest,
                            instructions: {
                              ...aiRequest.instructions,
                              [kind]: event.target.value,
                            },
                          })
                        }
                      />
                      <div className="ai-instructions-meta">
                        <small id={`ai-instructions-help-${kind}`}>
                          기본 지시를 수정하거나 추가하세요. 히스토리의 AI 작업
                          기록에 보관됩니다.
                        </small>
                        <small>
                          {aiRequest.instructions[kind].length.toLocaleString()}{' '}
                          / {MAX_TASK_INSTRUCTIONS.toLocaleString()}자
                        </small>
                      </div>
                      {!aiRequest.instructions[kind].trim() && (
                        <p role="alert">
                          작업 지시를 입력하거나 기본값으로 복원해주세요.
                        </p>
                      )}
                    </div>
                  ))}
                <p className="ai-instructions-protection">
                  입력 문서 보호, 선택 범위, 결과 파일 및 버전 규칙과 역할별
                  권한은 지시를 수정해도 유지됩니다.
                </p>
              </section>
              <details className="ai-advanced-settings">
                <summary>
                  AI 설정 · {getAiProvider(selectedAiProvider).label} ·{' '}
                  {getAiModelLabel(selectedAiProvider, selectedAiModel || null)}
                  <small>
                    {codexStatus?.available && codexStatus.authenticated
                      ? '연결 확인됨'
                      : '연결 확인 필요'}
                  </small>
                </summary>
                <div className="ai-model-fields">
                  <label>
                    AI 제공자
                    <select
                      aria-label="AI 제공자"
                      value={selectedAiProvider}
                      disabled={creatingTask}
                      onChange={(event) => {
                        setSelectedAiProvider(
                          event.target.value as AiProviderId,
                        );
                        setCodexStatus(null);
                        setSelectedAiModel('');
                      }}
                    >
                      {AI_PROVIDERS.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    모델 버전
                    <select
                      aria-label="모델 버전"
                      value={selectedAiModel}
                      disabled={creatingTask}
                      onChange={(event) =>
                        setSelectedAiModel(event.target.value)
                      }
                    >
                      {getAiProvider(selectedAiProvider).models.map((model) => (
                        <option key={model.id || 'default'} value={model.id}>
                          {model.label}
                        </option>
                      ))}
                      {selectedAiModel &&
                        !getAiProvider(selectedAiProvider).models.some(
                          (model) => model.id === selectedAiModel,
                        ) && (
                          <option value={selectedAiModel}>
                            직접 입력 · {selectedAiModel}
                          </option>
                        )}
                    </select>
                  </label>
                </div>
                <label className="ai-model-custom">
                  모델 ID 직접 입력 (선택)
                  <input
                    aria-label="모델 ID 직접 입력"
                    value={selectedAiModel}
                    disabled={creatingTask}
                    maxLength={128}
                    placeholder="비우면 CLI 기본 모델 사용"
                    onChange={(event) => setSelectedAiModel(event.target.value)}
                  />
                </label>
                <p>
                  {getAiProvider(selectedAiProvider).description} 설치·로그인은
                  ‘AI 연결 설정’에서 확인하세요.{' '}
                  {collaboration.active &&
                    selectedAiProvider !== 'codex-cli' &&
                    !collaboration.multiProviderAi &&
                    '서버 v0.8.0 이상으로 업데이트해야 합니다.'}
                </p>
                <div className="ai-connection-summary">
                  <span
                    className={
                      codexStatus?.available && codexStatus.authenticated
                        ? 'connection-ok'
                        : 'connection-error'
                    }
                  >
                    {codexStatus?.available && codexStatus.authenticated
                      ? `● ${getAiProvider(selectedAiProvider).label} 인증 정보 확인`
                      : `● ${getAiProvider(selectedAiProvider).label} 연결 필요`}
                  </span>
                  <button
                    disabled={creatingTask || checkingCodex}
                    onClick={() => void refreshCodexStatus()}
                  >
                    {checkingCodex ? '확인 중…' : '연결 확인'}
                  </button>
                  <small>
                    지시서는 내부에 보관하고 히스토리의 AI 작업 기록에서
                    확인합니다. 검증에 성공한 결과만 적용하며, 실패·중지 시 기존
                    결과를 유지합니다.
                  </small>
                </div>
              </details>
            </div>
            <footer>
              <button
                disabled={creatingTask}
                onClick={() => setAiRequest(null)}
              >
                취소
              </button>
              <button
                className="button-primary"
                disabled={
                  creatingTask ||
                  !canRunAi ||
                  locked ||
                  (!aiRequest.organize && !aiRequest.implement) ||
                  (collaboration.active &&
                    aiRequest.implement &&
                    !collaboration.htmlResultFolders) ||
                  (collaboration.active &&
                    aiRequest.sourceMode === 'html' &&
                    !collaboration.htmlImportAnalysis) ||
                  (aiRequest.sourceMode === 'html' &&
                    aiRequest.implement &&
                    aiRequest.htmlResult?.mode === 'update' &&
                    aiRequest.inputPaths.includes(
                      aiRequest.htmlResult.basePath ?? 'output/index.html',
                    )) ||
                  (aiRequest.organize &&
                    !aiRequest.instructions.organize.trim()) ||
                  (aiRequest.implement &&
                    !aiRequest.instructions.implement.trim()) ||
                  (collaboration.active &&
                    aiRequest.organize &&
                    aiRequest.implement &&
                    !collaboration.gamejamWorkflow) ||
                  !!resultNameError ||
                  (collaboration.active &&
                    !!aiRequest.resultName.trim() &&
                    !collaboration.taskResultNaming) ||
                  (collaboration.active &&
                    !collaboration.taskInstructionsEditable) ||
                  !codexStatus?.available ||
                  !codexStatus.authenticated ||
                  (collaboration.active &&
                    selectedAiProvider !== 'codex-cli' &&
                    !collaboration.multiProviderAi)
                }
                onClick={() => void submitAiRequest()}
              >
                {creatingTask ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Play size={15} />
                )}{' '}
                {creatingTask ? '준비 중…' : 'gamejam! 실행'}
              </button>
            </footer>
          </section>
        </div>
      )}

      {sectionRename && (
        <div className="dialog-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="섹션 이름 변경"
            className="section-dialog floating-surface"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setSectionRename(null);
            }}
          >
            <h2>섹션 이름 변경</h2>
            <input
              autoFocus
              aria-label="새 섹션 이름"
              maxLength={120}
              value={sectionRename.title}
              onChange={(event) =>
                setSectionRename({
                  ...sectionRename,
                  title: event.target.value,
                })
              }
            />
            <p>파일 경로와 문서 ID, 포함된 파일은 유지됩니다.</p>
            <div className="section-dialog__actions">
              <button onClick={() => setSectionRename(null)}>취소</button>
              <button
                className="button-primary"
                disabled={!sectionRename.title.trim() || locked}
                onClick={async () => {
                  try {
                    await window.gameCanvas.renameSection(
                      sectionRename.section.relativePath,
                      sectionRename.title,
                      sectionRename.section.revision,
                    );
                    setSectionRename(null);
                    await loadProject(false);
                  } catch (error) {
                    showError(error);
                  }
                }}
              >
                이름 변경
              </button>
            </div>
          </section>
        </div>
      )}

      {deleteManyPrompt && (
        <div className="dialog-backdrop">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-label="선택 문서 삭제 확인"
            className="section-dialog floating-surface"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setDeleteManyPrompt(null);
            }}
          >
            <h2>선택한 문서 {deleteManyPrompt.length}개를 삭제할까요?</h2>
            <p>
              섹션의 멤버 목록에서도 제거됩니다. 실행 취소 또는 히스토리에서
              복원할 수 있습니다. HTML 결과와 섹션 자체는 삭제하지 않습니다.
            </p>
            <ul>
              {deleteManyPrompt.map((doc) => (
                <li key={doc.id}>
                  {doc.title}
                  {doc.relativePath === 'project.md'
                    ? ' · 기본 문서 보호됨'
                    : ''}
                </li>
              ))}
            </ul>
            <div className="section-dialog__actions">
              <button autoFocus onClick={() => setDeleteManyPrompt(null)}>
                취소
              </button>
              <button
                className="button-danger"
                disabled={
                  locked ||
                  editBusy ||
                  !deleteManyPrompt.some(
                    (doc) => doc.relativePath !== 'project.md',
                  )
                }
                onClick={async () => {
                  setEditBusy(true);
                  try {
                    await flushEditors();
                    const currentDocuments =
                      await window.gameCanvas.listDocuments();
                    await window.gameCanvas.deleteDocuments(
                      deleteManyPrompt
                        .filter((doc) => doc.relativePath !== 'project.md')
                        .map((doc) => ({
                          documentId: doc.id,
                          relativePath: doc.relativePath,
                          revision: currentDocuments.find(
                            (current) => current.id === doc.id,
                          )?.revision,
                        })),
                    );
                    setDeleteManyPrompt(null);
                    await loadProject(false);
                    setNotice(
                      '선택 문서를 삭제했습니다. 실행 취소로 복원할 수 있습니다.',
                    );
                  } catch (error) {
                    showError(error);
                  } finally {
                    setEditBusy(false);
                  }
                }}
              >
                선택 문서 삭제
              </button>
            </div>
          </section>
        </div>
      )}

      {sectionDialogOpen && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              setSectionDialogOpen(false);
          }}
        >
          <section
            className="section-dialog floating-surface"
            role="dialog"
            aria-modal="true"
            aria-labelledby="section-dialog-title"
          >
            <div className="section-dialog__icon">
              <Frame size={20} />
            </div>
            <div>
              <p>GROUP FILES</p>
              <h2 id="section-dialog-title">선택 파일을 섹션으로 묶기</h2>
              <span>
                섹션 Markdown에 파일 ID와 경로가 저장되며, 섹션을 선택하면 전체
                파일이 AI 작업 범위에 포함됩니다.
              </span>
            </div>
            <label>
              섹션 이름
              <input
                autoFocus
                value={sectionTitle}
                onChange={(event) => setSectionTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void createSectionFromSelection();
                  if (event.key === 'Escape') setSectionDialogOpen(false);
                }}
                placeholder="예: 플레이어 캐릭터"
              />
            </label>
            <div className="section-dialog__members">
              {selectedDocuments.map((document) => (
                <span key={document.id}>{document.title}</span>
              ))}
            </div>
            <div className="section-dialog__actions">
              <button type="button" onClick={() => setSectionDialogOpen(false)}>
                취소
              </button>
              <button
                type="button"
                className="button-primary"
                onClick={() => void createSectionFromSelection()}
              >
                <Frame size={15} /> {selectedDocuments.length}개 파일 묶기
              </button>
            </div>
          </section>
        </div>
      )}

      {membershipPrompt && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              void cancelMembershipChange();
          }}
        >
          <section
            className="membership-dialog floating-surface"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="membership-dialog-title"
            aria-describedby="membership-dialog-description"
            onKeyDown={(event) => {
              if (event.key === 'Escape') void cancelMembershipChange();
            }}
          >
            <div className="membership-dialog__icon">
              <Frame size={20} />
            </div>
            <div>
              <p>SECTION MEMBERSHIP</p>
              <h2 id="membership-dialog-title">
                {membershipPrompt.fromSection && membershipPrompt.toSection
                  ? '파일을 다른 섹션으로 옮길까요?'
                  : membershipPrompt.toSection
                    ? '파일을 이 섹션에 추가할까요?'
                    : '파일을 이 섹션에서 제외할까요?'}
              </h2>
              <span id="membership-dialog-description">
                <strong>{membershipPrompt.document.title}</strong> 파일의 섹션
                소속과 캔버스 위치가 함께 저장됩니다.
              </span>
            </div>
            <div className="membership-dialog__route">
              <span>
                <small>현재</small>
                <strong>
                  {membershipPrompt.fromSection?.title ?? '섹션 없음'}
                </strong>
              </span>
              <span aria-hidden="true">→</span>
              <span>
                <small>변경 후</small>
                <strong>
                  {membershipPrompt.toSection?.title ?? '섹션 없음'}
                </strong>
              </span>
            </div>
            <div className="membership-dialog__actions">
              <button
                type="button"
                autoFocus
                onClick={() => void cancelMembershipChange()}
              >
                취소
              </button>
              <button
                type="button"
                className="button-primary"
                onClick={() => void confirmMembershipChange()}
              >
                {membershipPrompt.fromSection && membershipPrompt.toSection
                  ? '섹션 이동'
                  : membershipPrompt.toSection
                    ? '섹션에 추가'
                    : '섹션에서 제외'}
              </button>
            </div>
          </section>
        </div>
      )}

      {sectionActionPrompt && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              setSectionActionPrompt(null);
          }}
        >
          <section
            className="membership-dialog delete-dialog floating-surface"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="section-action-dialog-title"
            aria-describedby="section-action-dialog-description"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setSectionActionPrompt(null);
            }}
          >
            <div
              className={`membership-dialog__icon ${
                sectionActionPrompt.deleteMembers ? 'delete-dialog__icon' : ''
              }`}
            >
              {sectionActionPrompt.deleteMembers ? (
                <Trash2 size={20} />
              ) : (
                <Ungroup size={20} />
              )}
            </div>
            <div>
              <p>
                {sectionActionPrompt.deleteMembers
                  ? 'DELETE SECTION AND FILES'
                  : 'UNGROUP SECTION'}
              </p>
              <h2 id="section-action-dialog-title">
                {sectionActionPrompt.deleteMembers
                  ? '섹션과 안의 파일을 모두 삭제할까요?'
                  : '이 섹션을 해제할까요?'}
              </h2>
              <span id="section-action-dialog-description">
                <strong>{sectionActionPrompt.section.title}</strong>{' '}
                {sectionActionPrompt.deleteMembers
                  ? `섹션과 안에 있는 메모·파일 ${sectionActionPrompt.section.members.length}개를 Windows 휴지통으로 이동합니다.`
                  : `섹션 정의만 Windows 휴지통으로 이동하며, 안에 있는 메모·파일 ${sectionActionPrompt.section.members.length}개는 캔버스에 그대로 남습니다.`}
              </span>
            </div>
            {sectionActionPrompt.deleteMembers &&
              sectionActionPrompt.section.members.some(
                (member) => member.path === 'project.md',
              ) && (
                <div className="delete-dialog__path">
                  <strong>
                    project.md는 프로젝트 기본 문서이므로 삭제하지 않습니다.
                  </strong>
                </div>
              )}
            <div className="delete-dialog__path">
              <code>{sectionActionPrompt.section.relativePath}</code>
            </div>
            <div className="membership-dialog__actions">
              <button
                type="button"
                autoFocus
                onClick={() => setSectionActionPrompt(null)}
              >
                취소
              </button>
              <button
                type="button"
                className={
                  sectionActionPrompt.deleteMembers
                    ? 'button-danger'
                    : 'button-primary'
                }
                onClick={() => void confirmSectionAction()}
              >
                {sectionActionPrompt.deleteMembers ? (
                  <>
                    <Trash2 size={14} /> 섹션과 파일 삭제
                  </>
                ) : (
                  <>
                    <Ungroup size={14} /> 섹션 해제
                  </>
                )}
              </button>
            </div>
          </section>
        </div>
      )}

      {deletePrompt && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDeletePrompt(null);
          }}
        >
          <section
            className="membership-dialog delete-dialog floating-surface"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            aria-describedby="delete-dialog-description"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setDeletePrompt(null);
            }}
          >
            <div className="membership-dialog__icon delete-dialog__icon">
              <Trash2 size={20} />
            </div>
            <div>
              <p>DELETE FILE</p>
              <h2 id="delete-dialog-title">이 파일을 삭제할까요?</h2>
              <span id="delete-dialog-description">
                <strong>{deletePrompt.title}</strong> 파일을 Windows 휴지통으로
                이동합니다. 섹션에 포함되어 있다면 멤버 목록에서도 제거됩니다.
              </span>
            </div>
            <div className="delete-dialog__path">
              <code>{deletePrompt.relativePath}</code>
              {deletePrompt.asset && (
                <p>
                  이미지 카드의 설명 문서만 삭제합니다. 다른 문서나 HTML에서
                  참조할 수 있으므로 프로젝트 안의 이미지 원본은 유지됩니다.
                </p>
              )}
            </div>
            <div className="membership-dialog__actions">
              <button
                type="button"
                autoFocus
                onClick={() => setDeletePrompt(null)}
              >
                취소
              </button>
              <button
                type="button"
                className="button-danger"
                onClick={() => void deleteDocument()}
              >
                <Trash2 size={14} /> 휴지통으로 이동
              </button>
            </div>
          </section>
        </div>
      )}

      <div className="status-toast floating-surface">
        <span className="status-dot" />
        <span>{notice}</span>
        {hasTaskSelection && (
          <strong>
            파일 {selectedDocuments.length} · 섹션 {selectedSections.length}
          </strong>
        )}
      </div>
    </main>
  );
}

export function App() {
  return (
    <ReactFlowProvider>
      <WorkspaceCanvas />
    </ReactFlowProvider>
  );
}
