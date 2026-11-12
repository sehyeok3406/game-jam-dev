import { Box, ExternalLink, FolderOpen, Maximize2 } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import type { ModelAsset } from '../../contracts/documents';
import { modelExtension } from '../../core/projects/model-assets';
import { CanvasItemResizer } from '../canvas/CanvasItemResizer';
import { useRuntime } from '../runtime/RuntimeProvider';
import { requireDesktopApi } from '../runtime/desktop-api';
import { ModelPreviewDialog } from './ModelPreviewDialog';
import type { DocumentNodeData } from './types';
import './model-node.css';

export const ModelNode = memo(function ModelNode({
  asset,
  data,
  selected,
}: {
  asset: ModelAsset;
  data: DocumentNodeData;
  selected: boolean;
}) {
  const { api } = useRuntime();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<{
    clips: number;
    thumbnail: string;
  }>();
  const [error, setError] = useState('');
  const format = modelExtension(asset.path)!;
  const blend = format === 'blend';
  const { document } = data;
  const clips = summary?.clips;

  useEffect(() => {
    if (data.sectionHidden) setOpen(false);
  }, [data.sectionHidden]);

  const report = (error: unknown) =>
    setError(
      error instanceof Error
        ? error.message.replace(/^.*?Error: /, '')
        : String(error),
    );
  const openFile = () => {
    setError('');
    if (blend) {
      if (!data.sessionId || !api.desktop) {
        setError('Blender 원본은 로컬 데스크톱 프로젝트에서 열 수 있습니다.');
        return;
      }
      void requireDesktopApi(api)
        .openBlendSource(asset.path, data.sessionId)
        .catch(report);
    } else setOpen(true);
  };
  const label = blend ? 'Blender로 열기' : '3D 미리보기 열기';
  return (
    <>
      {!document.collapsed && (
        <CanvasItemResizer
          color="var(--selection)"
          isVisible={selected && !data.layoutLocked}
          lineClassName="window-resize-edge"
          handleClassName="window-resize-handle"
          minWidth={250}
          minHeight={blend ? 116 : 170}
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
        className="model-node"
        data-find-document={document.id}
        data-collapsed={document.collapsed}
        inert={data.sectionHidden || undefined}
      >
        <header className="document-card__header model-node__header">
          <Box size={19} aria-hidden="true" />
          <strong title={document.title}>{document.title}</strong>
          <small className="model-format">{format.toUpperCase()}</small>
          {document.collapsed && (
            <button
              type="button"
              className="nodrag model-node__icon"
              onClick={openFile}
              aria-label={label}
              title={label}
              aria-haspopup={blend ? undefined : 'dialog'}
            >
              {blend ? <ExternalLink size={15} /> : <Maximize2 size={15} />}
            </button>
          )}
        </header>
        {!document.collapsed && (
          <>
            {!blend && (
              <div className="model-node__thumb" aria-hidden="true">
                {summary?.thumbnail ? (
                  <img alt="" src={summary.thumbnail} draggable={false} />
                ) : (
                  <Box size={30} />
                )}
              </div>
            )}
            <div className="model-node__actions nodrag">
              <small>
                {blend
                  ? 'Blender 원본'
                  : clips
                    ? `애니메이션 ${clips}개`
                    : clips === 0 || format === 'obj'
                      ? '정적 모델'
                      : '3D 모델'}
              </small>
              {blend && (
                <button
                  type="button"
                  className="model-node__icon"
                  title="원본 파일 보기"
                  aria-label="원본 파일 보기"
                  onClick={() =>
                    void requireDesktopApi(api)
                      .revealPath(asset.path)
                      .catch(report)
                  }
                >
                  <FolderOpen size={15} />
                </button>
              )}
              <button
                type="button"
                className="model-node__open"
                onClick={openFile}
                aria-label={label}
                aria-haspopup={blend ? undefined : 'dialog'}
              >
                {blend ? 'Blender로 열기' : '미리보기'}{' '}
                {blend ? <ExternalLink size={13} /> : <Maximize2 size={13} />}
              </button>
            </div>
          </>
        )}
        {error && (
          <small className="model-node__error" role="status">
            {error}
          </small>
        )}
      </article>
      {open && !data.sectionHidden && !blend && (
        <ModelPreviewDialog
          asset={asset}
          format={format}
          title={document.title}
          onSummary={setSummary}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
});
