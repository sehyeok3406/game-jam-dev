import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import {
  Monitor,
  Shrink,
  Expand,
  RefreshCw,
  History,
  Columns2,
  Maximize2,
  Minimize2,
  Info,
} from 'lucide-react';
import type { FilePropertyVisibility } from '../../file-properties';
import type { DocumentStatuses } from '../../contracts/document-statuses';
import type {
  PreviewResult,
  PreviewWindowState,
} from '../../contracts/preview';
import { cardColor } from '../../card-colors';
import {
  PREVIEW_PRESETS,
  selectPreviewPreset,
  fitPreviewViewport,
} from '../../preview-window';
import { previewLabel } from '../../preview-output';
import { PREVIEW_SANDBOX } from '../../preview-permissions';
import { FilePropertyBadges } from '../FileProperties';
import { DocumentBacklinks } from '../DocumentBacklinks';
import { useDocumentLinks } from '../DocumentLinksContext';
import { MultiplayerLobby } from '../MultiplayerLobby';
import { usePreviewPlayback } from './usePreviewPlayback';

export type PreviewNodeData = {
  aiUsage?: string;
  propertyVisibility: FilePropertyVisibility;
  authorshipKey: string;
  onDetails: () => void;
  sectionHidden?: boolean;
  statuses: DocumentStatuses;
  workflowDisabled: boolean;
  workflowReason?: string;
  onWorkflow: (id: string) => void;
  onManageWorkflow: () => void;
  kind: 'preview';
  locked: boolean;
  preview: PreviewResult;
  windowState: PreviewWindowState;
  busy: boolean;
  onWindowChange: (state: PreviewWindowState) => Promise<void>;
  onHistory: () => void;
  onCompare: () => void;
  onMultiplayerRepair: () => void;
  multiplayerRepairDisabled: boolean;
};

export type PreviewCanvasNode = Node<PreviewNodeData, 'preview'>;

export function PreviewCard({ data, selected }: NodeProps<PreviewCanvasNode>) {
  const pageLinks = useDocumentLinks();
  const linkedDocument = pageLinks.documents.find(
    (doc) => doc.htmlSource === data.preview.relativePath,
  );
  const state = data.windowState;
  const {
    restart,
    setRestart,
    cardRef,
    playAreaRef,
    settingsRef,
    settingsId,
    fullscreen,
    fullscreenError,
    playAreaSize,
    settingsPosition,
    setSettingsPosition,
    preset,
    viewport,
    previewHtml,
    collapsed,
    toggleFullscreen,
  } = usePreviewPlayback(
    data.preview.content,
    data.preview.relativePath,
    state,
  );
  return (
    <>
      {!preset && !collapsed && !fullscreen && (
        <NodeResizer
          color="var(--selection)"
          isVisible={selected && !state.collapsed && !data.locked}
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
        data-ai-usage={data.aiUsage || undefined}
        inert={data.sectionHidden || undefined}
        data-card-color={cardColor(data.preview.backgroundColor)}
        className={`preview-card${collapsed ? ' preview-card--collapsed' : ''}${!collapsed && data.preview.warnings?.length ? ' preview-card--warning' : ''}${state.width < 560 && !fullscreen ? ' preview-card--compact' : ''}`}
      >
        <header className={fullscreen ? 'nodrag' : 'preview-drag-handle'}>
          {data.aiUsage && (
            <span className="ai-material-badge nodrag" title={data.aiUsage}>
              {data.aiUsage}
            </span>
          )}
          <strong
            title={data.preview.relativePath}
            data-find-section={`preview:${data.preview.relativePath}`}
          >
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
            <MultiplayerLobby
              path={data.preview.relativePath}
              html={data.preview.content}
              onRepair={data.onMultiplayerRepair}
              repairDisabled={data.multiplayerRepairDisabled}
            />
            <button
              className="icon-button"
              title="HTML 버전 비교"
              disabled={fullscreen}
              onClick={data.onCompare}
            >
              <Columns2 size={14} />
            </button>
            <FilePropertyBadges
              document={data.preview}
              relativePath={data.preview.relativePath}
              authorshipKey={data.authorshipKey}
              visibility={data.propertyVisibility}
              details={data.onDetails}
              statuses={data.statuses}
              disabled={data.workflowDisabled}
              reason={data.workflowReason}
              change={data.onWorkflow}
              manage={data.onManageWorkflow}
            />
            <button
              type="button"
              className="icon-button"
              title={state.collapsed ? 'HTML 창 펼치기' : 'HTML 창 최소화'}
              disabled={fullscreen || data.locked}
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
            <button
              className="icon-button"
              title="문서 상세 정보"
              onClick={data.onDetails}
            >
              <Info size={14} />
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
            disabled={data.locked}
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
        {!collapsed && linkedDocument && (
          <DocumentBacklinks path={linkedDocument.relativePath} />
        )}
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
