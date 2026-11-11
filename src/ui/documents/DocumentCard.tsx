import { memo, useLayoutEffect, type KeyboardEvent } from 'react';
import { type NodeProps } from '@xyflow/react';
import {
  CanvasItemResizer,
  useImageDescriptionPresentation,
} from '../canvas/CanvasItemResizer';
import { useRuntime } from '../runtime/RuntimeProvider';
import { cardColor } from '../../card-colors';
import { FilePropertyBadges } from '../FileProperties';
import { Maximize2, Minimize2, Info, Link2, Bot } from 'lucide-react';
import { MarkdownEditor } from '../MarkdownEditor';
import { requireDesktopApi } from '../runtime/desktop-api';
import { DocumentMarkdown } from '../DocumentMarkdown';
import { resolveAssetLink } from '../../asset-links';
import { DocumentBacklinks } from '../DocumentBacklinks';
import { ProjectImage } from './ProjectImage';
import {
  FileNodeSurface,
  fileNodeVariables,
  opensFileNode,
} from '../canvas/FileNodeSurface';
import { imageDescription } from '../../core/canvas/image-description';
import { fittedImage, imageResizeRange } from '../../core/canvas/image-layout';
import { useDocumentEditing } from './useDocumentEditing';
import { readingBlockFocus } from './markdown-title';
import type { DocumentCanvasNode } from './types';
import { useLocationSharing } from '../locations/LocationSharingContext.ts';
import { useDocumentSourceTitles } from '../DocumentLinksContext';
import {
  CanvasContentGate,
  useCanvasProtection,
} from '../canvas/CanvasContent';
export type { DocumentCanvasNode, DocumentNodeData } from './types';

const DocumentCardContent = memo(function DocumentCardContent({
  data,
  selected,
}: Pick<NodeProps<DocumentCanvasNode>, 'data' | 'selected'>) {
  const { api, capabilities } = useRuntime();
  const locationSharing = useLocationSharing();
  const { document } = data;
  const assetPath = document.asset?.path;
  const reportImageEditing = useImageDescriptionPresentation();
  const copyBlock = locationSharing?.anchors
    ? (blockId: string) =>
        locationSharing.copy({
          kind: document.identitySource === 'path' ? 'file' : 'document',
          id:
            document.identitySource === 'path'
              ? document.relativePath
              : document.id,
          blockId,
        })
    : undefined;
  const {
    cardRef,
    titleRef,
    editing,
    title,
    body,
    saving,
    nameSaving,
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
    cancelName,
    save,
    loadLatest,
    setTaskError,
    startEdit,
    toggleTask,
    restoreDraft,
    finishing,
  } = useDocumentEditing(data);
  const showImageCard = !!assetPath && (editing || !!cachedDraft || saveFailed);
  useLayoutEffect(() => {
    if (!showImageCard || !reportImageEditing) return;
    reportImageEditing(document.id, true);
    return () => reportImageEditing(document.id, false);
  }, [showImageCard, document.id, reportImageEditing]);
  useCanvasProtection(
    editing ||
      startingEdit ||
      saving ||
      nameSaving ||
      saveFailed ||
      !!cachedDraft ||
      !!taskError,
  );

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.isPropagationStopped()) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      void (
        event.target === titleRef.current ? cancelName() : finishEdit()
      ).catch(() => undefined);
    }
    if (event.key === 'Enter' && event.target === titleRef.current) {
      event.preventDefault();
      event.stopPropagation();
      void finishEdit().catch(() => undefined);
      return;
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
  };

  if (document.collapsed && data.fileNode)
    return (
      <FileNodeSurface
        kind="md"
        title={document.title}
        body={document.body}
        display={data.fileNode}
        selected={selected}
        hidden={data.sectionHidden}
        locked={data.layoutLocked}
        onOpen={data.onOpenFileNode}
        onResize={data.onResizeFileNode}
      />
    );

  if (document.asset && !showImageCard) {
    const image = data.imageAspect
      ? fittedImage(document, data.imageAspect)
      : null;
    const range = imageResizeRange(document);
    return (
      <>
        {image && (
          <CanvasItemResizer
            color="var(--selection)"
            isVisible={selected && !data.layoutLocked}
            lineClassName="window-resize-edge"
            handleClassName="window-resize-handle"
            minWidth={image.width * range.min}
            minHeight={image.height * range.min}
            maxWidth={image.width * range.max}
            maxHeight={image.height * range.max}
            keepAspectRatio
          />
        )}
        <article
          ref={cardRef}
          className={
            image
              ? 'asset-node-surface asset-node-fitted'
              : 'asset-node-surface'
          }
          role="button"
          tabIndex={0}
          aria-label={`${document.title} 설명 편집`}
          inert={data.sectionHidden || undefined}
          onClick={(event) => {
            if (
              opensFileNode(event) &&
              !(event.target as Element).closest('button')
            )
              void startEdit();
          }}
          onKeyDown={(event) => {
            if (
              event.target === event.currentTarget &&
              (event.key === 'Enter' || event.key === ' ')
            ) {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.click();
            }
          }}
        >
          <ProjectImage
            path={document.asset.path}
            title={document.title}
            cacheKey={data.imageKey ?? data.draftKey}
            onAspect={data.onImageAspect}
          />
        </article>
      </>
    );
  }

  const description =
    document.asset && editing
      ? imageDescription(body, document.asset.path)
      : undefined;

  return (
    <>
      {!document.collapsed && !document.asset && (
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
        style={
          data.fileNode
            ? fileNodeVariables(data.fileNode.style, 'md', document.height)
            : undefined
        }
        className={`document-card document-card--${document.type}${document.collapsed ? ' document-card--collapsed' : ''}${data.fileNode ? ' file-node-expanded' : ''}`}
      >
        <header className="document-card__header canvas-file-header">
          <div className="canvas-file-header__name">
            {description ? (
              <strong className="document-card__title canvas-file-header__title">
                {document.title}
              </strong>
            ) : editing ? (
              <input
                className="document-card__title canvas-file-header__title nodrag nowheel"
                ref={titleRef}
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={() => setComposing(false)}
                onKeyDown={handleEditorKeyDown}
                aria-label="문서 제목"
                aria-invalid={saveFailed || undefined}
                title="Enter로 이름·파일명 변경 · Esc로 이름 변경 취소"
                value={title}
                readOnly={data.locked || nameSaving}
                onChange={(event) => updateTitle(event.target.value)}
              />
            ) : document.collapsed ? (
              <strong
                className="document-card__title canvas-file-header__title"
                title={document.title}
              >
                {document.title}
              </strong>
            ) : (
              <button
                type="button"
                className="document-card__title canvas-file-header__title nodrag"
                title={document.title}
                aria-label={`문서 제목 편집: ${document.title}`}
                aria-disabled={data.locked}
                onKeyDown={(event) => {
                  if (
                    (event.key === 'Enter' || event.key === ' ') &&
                    !event.ctrlKey &&
                    !event.metaKey &&
                    !event.altKey
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    void startEdit({ title: true });
                  }
                }}
                onClick={(event) => {
                  if (event.shiftKey || event.ctrlKey || event.metaKey) return;
                  void startEdit({ title: true });
                }}
              >
                {document.title}
              </button>
            )}
            {data.aiUsage && (
              <span className="ai-material-badge nodrag" title={data.aiUsage}>
                {data.aiUsage}
              </span>
            )}
          </div>

          <div className="document-header-actions nodrag">
            {document.type !== 'ai-task' && (
              <FilePropertyBadges
                document={document}
                visibility={data.propertyVisibility}
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
              aria-label={document.collapsed ? '펼치기' : '접기'}
              disabled={!data.fileNode && data.layoutLocked}
              onClick={() => {
                if (editing)
                  void finishEdit()
                    .then(data.onCollapse)
                    .catch(() => undefined);
                else data.onCollapse();
              }}
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
                onKeyDown={handleEditorKeyDown}
              >
                <MarkdownEditor
                  onCopyBlock={copyBlock}
                  currentCanvas={document.canvasId}
                  referencePreview={
                    assetPath && (
                      <div
                        className="asset-description-preview"
                        role="group"
                        aria-label="설명할 이미지 미리보기"
                      >
                        <ProjectImage
                          path={assetPath}
                          title={document.title}
                          cacheKey={data.imageKey ?? data.draftKey}
                          onAspect={data.onImageAspect}
                        />
                      </div>
                    )
                  }
                  value={description?.body ?? body}
                  onCompositionChange={setComposing}
                  locked={data.locked}
                  owner={editorOwner}
                  title={title}
                  onTitle={description ? undefined : updateTitle}
                  status={editStatus}
                  onSave={() => void save().catch(() => undefined)}
                  onFinish={() => void finishEdit().catch(() => undefined)}
                  initialFocus={editFocus}
                  onChange={
                    description
                      ? (next) => updateBody(description.replace(next))
                      : updateBody
                  }
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
                  if (document.asset) {
                    void startEdit();
                    return;
                  }
                  if (document.type === 'image') return;
                  if (data.locked) data.onBlocked();
                  else
                    void startEdit({
                      title: false,
                      point: { x: event.clientX, y: event.clientY },
                      block:
                        event.target instanceof Element
                          ? readingBlockFocus(event.target, {
                              x: event.clientX,
                              y: event.clientY,
                            })
                          : undefined,
                    });
                }}
                title={
                  document.asset
                    ? '클릭해서 이미지 설명 편집'
                    : '클릭해서 바로 편집'
                }
              >
                <CanvasContentGate
                  label={
                    document.type === 'image' ? '이미지 참고 자료' : '문서'
                  }
                >
                  {document.asset && (
                    <div className="image-card-preview nowheel">
                      <ProjectImage
                        path={document.asset.path}
                        title={document.title}
                        cacheKey={data.imageKey ?? data.draftKey}
                        onAspect={data.onImageAspect}
                      />
                      <span>
                        {document.asset.purpose === 'asset'
                          ? '게임 에셋'
                          : '설명 도식'}{' '}
                        · {document.asset.originalName} ·{' '}
                        {(document.asset.bytes / 1024).toFixed(1)} KB
                      </span>
                    </div>
                  )}
                  {taskError && (
                    <p className="markdown-editor-warning" role="alert">
                      {taskError}
                    </p>
                  )}
                  <div className="markdown-body nowheel">
                    <DocumentMarkdown
                      copyBlock={copyBlock}
                      body={document.body}
                      title={document.title}
                      disabled={
                        data.locked ||
                        saving ||
                        startingEdit ||
                        !!data.editingBy
                      }
                      onToggle={(offset, checked) =>
                        void toggleTask(offset, checked)
                      }
                      image={({ src, alt }) => {
                        const path = resolveAssetLink(
                          src,
                          document.relativePath,
                        );
                        if (path && path === document.asset?.path) return null;
                        return path ? (
                          <ProjectImage
                            path={path}
                            title={alt ?? ''}
                            cacheKey={`${data.draftKey}:${document.assetVersion ?? 0}`}
                            version={document.assetVersion ?? 0}
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
                </CanvasContentGate>
              </div>
            )}

            <DocumentBacklinks path={document.relativePath} />
            {document.sources.length > 0 && (
              <DocumentSources
                id={document.id}
                sources={document.sources}
                open={data.onSource}
              />
            )}

            {document.type === 'ai-task' && (
              <div className="card-actions nodrag">
                <button
                  type="button"
                  disabled={!capabilities.nativeClipboard}
                  onClick={() => void data.onCopyTask(document)}
                >
                  <Bot size={13} /> 작업 복사
                </button>
              </div>
            )}
          </>
        )}
      </article>
    </>
  );
});

const DocumentSources = memo(function DocumentSources({
  id,
  sources,
  open,
}: {
  id: string;
  sources: DocumentCanvasNode['data']['document']['sources'];
  open: (id: string) => void;
}) {
  const titles = useDocumentSourceTitles();
  return (
    <details className="source-list nodrag">
      <summary>
        <Link2 size={12} /> 참고 메모 {sources.length}개
      </summary>
      {sources.map((source) => (
        <button
          type="button"
          key={`${id}-${source.id}`}
          onClick={() => open(source.id)}
          title={source.contribution}
        >
          {titles[source.id] ?? source.id}
        </button>
      ))}
    </details>
  );
});

// Position and dragging belong to React Flow; content receives only its own inputs.
export function DocumentCard({
  data,
  selected,
}: NodeProps<DocumentCanvasNode>) {
  return <DocumentCardContent data={data} selected={selected} />;
}
