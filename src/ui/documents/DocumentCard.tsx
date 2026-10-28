import { memo } from 'react';
import { type NodeProps } from '@xyflow/react';
import { CanvasItemResizer } from '../canvas/CanvasItemResizer';
import { useRuntime } from '../runtime/RuntimeProvider';
import { cardColor } from '../../card-colors';
import { FilePropertyBadges } from '../FileProperties';
import { Maximize2, Minimize2, Info, Link2, Bot } from 'lucide-react';
import { MarkdownEditor } from '../MarkdownEditor';
import { requireDesktopApi } from '../runtime/desktop-api';
import { DocumentMarkdown } from '../DocumentMarkdown';
import { resolveAssetLink } from '../../asset-links';
import { DocumentBacklinks } from '../DocumentBacklinks';
import { TYPE_LABELS } from './presentation';
import { ProjectImage } from './ProjectImage';
import { useDocumentEditing } from './useDocumentEditing';
import type { DocumentCanvasNode } from './types';
export type { DocumentCanvasNode, DocumentNodeData } from './types';

const DocumentCardContent = memo(function DocumentCardContent({
  data,
  selected,
}: Pick<NodeProps<DocumentCanvasNode>, 'data' | 'selected'>) {
  const { api, capabilities } = useRuntime();
  const { document } = data;
  const {
    cardRef,
    titleRef,
    editing,
    title,
    body,
    saving,
    startingEdit,
    editFocus,
    editorOwner,
    taskError,
    cachedDraft,
    queueState,
    saveFailed,
    editStatus,
    setComposing,
    updateTitle,
    updateBody,
    finishEdit,
    save,
    loadLatest,
    setTaskError,
    startEdit,
    toggleTask,
    restoreDraft,
    finishing,
  } = useDocumentEditing(data);

  return (
    <>
      {!document.collapsed && (
        <CanvasItemResizer
          color="var(--selection)"
          isVisible={selected && !data.layoutLocked}
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
        data-ai-usage={data.aiUsage || undefined}
        inert={data.sectionHidden || undefined}
        data-find-document={document.id}
        data-card-color={cardColor(document.backgroundColor)}
        className={`document-card document-card--${document.type}${document.collapsed ? ' document-card--collapsed' : ''}`}
      >
        <header className="document-card__header">
          {data.aiUsage ? (
            <span className="ai-material-badge nodrag" title={data.aiUsage}>
              {data.aiUsage}
            </span>
          ) : (
            <span className="document-type">{TYPE_LABELS[document.type]}</span>
          )}
          {document.collapsed && (
            <strong className="document-card__collapsed-title">
              {document.title}
            </strong>
          )}

          <div className="document-header-actions nodrag">
            {document.type !== 'ai-task' && (
              <FilePropertyBadges
                document={document}
                relativePath={document.relativePath}
                authorshipKey={data.authorshipKey}
                visibility={data.propertyVisibility}
                details={data.onDetails}
                statuses={data.statuses}
                disabled={data.workflowDisabled}
                reason={data.workflowReason}
                change={data.onWorkflow}
                manage={data.onManageWorkflow}
              />
            )}
            <button
              className="icon-button"
              title={document.collapsed ? '메모 펼치기' : '메모 최소화'}
              disabled={data.layoutLocked}
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
                    void finishEdit().catch(() => undefined);
                  }
                  if (
                    (event.ctrlKey || event.metaKey) &&
                    ['Enter', 's'].includes(event.key)
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    void (event.key === 'Enter' ? finishEdit() : save()).catch(
                      () => undefined,
                    );
                  }
                }}
              >
                <input
                  ref={titleRef}
                  onCompositionStart={() => setComposing(true)}
                  onCompositionEnd={() => setComposing(false)}
                  aria-label="문서 제목"
                  value={title}
                  readOnly={data.locked}
                  onChange={(event) => updateTitle(event.target.value)}
                />
                <MarkdownEditor
                  currentCanvas={document.canvasId}
                  value={body}
                  onCompositionChange={setComposing}
                  locked={data.locked}
                  owner={editorOwner}
                  title={title}
                  onTitle={updateTitle}
                  status={editStatus}
                  onSave={() => void save().catch(() => undefined)}
                  onFinish={() => void finishEdit().catch(() => undefined)}
                  initialFocus={editFocus}
                  onChange={updateBody}
                />
                <div className="document-editor__actions">
                  <span
                    role="status"
                    title="Ctrl+S로 저장 · Ctrl+Enter로 편집 완료"
                  >
                    {editStatus}
                  </span>
                  {taskError && <span role="alert">{taskError}</span>}
                  {cachedDraft && (
                    <button type="button" onClick={restoreDraft}>
                      보관된 초안 불러오기
                    </button>
                  )}
                  {queueState &&
                    ['conflict', 'failed'].includes(queueState.phase) && (
                      <>
                        <button
                          type="button"
                          disabled={!capabilities.nativeClipboard}
                          title={
                            !capabilities.nativeClipboard
                              ? '클립보드 복사를 지원하지 않는 실행 환경입니다.'
                              : undefined
                          }
                          onClick={() =>
                            void requireDesktopApi(api).copyText(
                              `${title}\n\n${body}`,
                            )
                          }
                        >
                          초안 복사
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void loadLatest().catch((error) =>
                              setTaskError(
                                error instanceof Error
                                  ? error.message
                                  : String(error),
                              ),
                            )
                          }
                        >
                          최신 내용 불러오기
                        </button>
                      </>
                    )}
                  <button
                    type="button"
                    className="button-primary"
                    onClick={() => void finishEdit().catch(() => undefined)}
                    disabled={finishing || data.locked}
                  >
                    {finishing ? '저장 중' : saveFailed ? '다시 저장' : '완료'}
                  </button>
                </div>
                {queueState?.error && (
                  <p className="markdown-editor-warning" role="status">
                    {queueState.error}
                  </p>
                )}
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
                        disabled={!capabilities.nativeClipboard}
                        onClick={() =>
                          void requireDesktopApi(api).copyText(
                            document.asset!.path,
                          )
                        }
                      >
                        에셋 경로 복사
                      </button>
                      <button
                        disabled={!capabilities.localFiles}
                        onClick={() =>
                          void requireDesktopApi(api).revealPath(
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
                          cacheKey={`${data.draftKey}:${document.assetVersion ?? 0}`}
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

            <DocumentBacklinks path={document.relativePath} />
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
                  disabled={!capabilities.nativeClipboard}
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
});

// Position and dragging belong to React Flow; content receives only its own inputs.
export function DocumentCard({
  data,
  selected,
}: NodeProps<DocumentCanvasNode>) {
  return <DocumentCardContent data={data} selected={selected} />;
}
