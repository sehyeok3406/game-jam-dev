import { FolderOpen, LoaderCircle, Upload, X } from 'lucide-react';
import type { DrawingObject } from '../../drawing-types';
import type { CanvasSheets, PreviewResult } from '../../shared';
import { ResultFolderDialog } from '../ResultFolderDialog';
interface Props {
  moveCanvasItems: () => Promise<void>;
  saveResultFolder: (
    input?: import('../../contracts/results').MoveResultInput,
  ) => Promise<void>;
  movingCanvasItems: {
    paths: string[];
    source: string;
    drawings?: DrawingObject[];
  } | null;
  moveCanvasTarget: string;
  setMoveCanvasTarget: import('react').Dispatch<
    import('react').SetStateAction<string>
  >;
  canvasSheets: CanvasSheets;
  canvasOperationBusy: boolean;
  setMovingCanvasItems: import('react').Dispatch<
    import('react').SetStateAction<{
      paths: string[];
      source: string;
      drawings?: DrawingObject[];
    } | null>
  >;

  resultFolderPrompt: PreviewResult | 'legacy' | null;
  previews: PreviewResult[];
  movingResults: boolean;
  setResultFolderPrompt: import('react').Dispatch<
    import('react').SetStateAction<PreviewResult | 'legacy' | null>
  >;

  importTarget: { x: number; y: number } | null;
  importingFiles: boolean;
  setImportTarget: (
    value: import('react').SetStateAction<{ x: number; y: number } | null>,
  ) => void;
  imagePurpose: 'asset' | 'diagram';
  setImagePurpose: (
    value: import('react').SetStateAction<'asset' | 'diagram'>,
  ) => void;
  importError: string;
  locked: boolean;
  importFiles: () => Promise<void>;
}
export function WorkspaceTransferDialogs({
  moveCanvasItems,
  saveResultFolder,
  movingCanvasItems,
  moveCanvasTarget,
  setMoveCanvasTarget,
  canvasSheets,
  canvasOperationBusy,
  setMovingCanvasItems,
  resultFolderPrompt,
  previews,
  movingResults,
  setResultFolderPrompt,
  importTarget,
  importingFiles,
  setImportTarget,
  imagePurpose,
  setImagePurpose,
  importError,
  locked,
  importFiles,
}: Props) {
  return (
    <>
      {movingCanvasItems && (
        <div data-ui-id="canvas-move" className="dialog-backdrop">
          <section
            className="canvas-sheet-dialog floating-surface"
            role="dialog"
            aria-modal="true"
            aria-labelledby="move-canvas-title"
          >
            <h2 id="move-canvas-title">다른 캔버스로 이동</h2>
            <p>섹션을 옮기면 내부 자료도 함께 이동합니다.</p>
            <label>
              대상 캔버스
              <select
                value={moveCanvasTarget}
                onChange={(event) => setMoveCanvasTarget(event.target.value)}
              >
                {canvasSheets.canvases
                  .filter((sheet) => sheet.id !== movingCanvasItems.source)
                  .map((sheet) => (
                    <option key={sheet.id} value={sheet.id}>
                      {sheet.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="canvas-sheet-dialog__actions">
              <button
                disabled={canvasOperationBusy}
                onClick={() => setMovingCanvasItems(null)}
              >
                취소
              </button>
              <button
                className="button-primary"
                disabled={canvasOperationBusy || !moveCanvasTarget}
                onClick={() => void moveCanvasItems()}
              >
                이동
              </button>
            </div>
          </section>
        </div>
      )}
      {resultFolderPrompt && (
        <ResultFolderDialog
          key={
            typeof resultFolderPrompt === 'string'
              ? 'legacy'
              : resultFolderPrompt.relativePath
          }
          preview={
            typeof resultFolderPrompt === 'string'
              ? undefined
              : resultFolderPrompt
          }
          previews={previews}
          busy={movingResults}
          onClose={() => setResultFolderPrompt(null)}
          onMove={saveResultFolder}
          onOrganize={() => saveResultFolder()}
        />
      )}
      {importTarget && (
        <div
          data-ui-id="import"
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
              공동 작업에서는 서버 사본에 공유됩니다. AI 작업 관련 파일만
              보호하며 새 파일은 계속 불러올 수 있습니다. 뷰어는 파일을 추가할
              수 없습니다.
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
    </>
  );
}
