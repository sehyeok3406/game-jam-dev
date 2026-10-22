import { Trash2 } from 'lucide-react';
import type { CanvasSection } from '../../contracts/canvas';
import type { DrawingObject } from '../../contracts/drawing-types';
import { isPreviewPath, previewDeletionTarget } from '../../preview-output';
import type { DeletionItem } from './selection-plan';

export function SelectionDeleteDialogs({
  part,
  deletePrompt,
  deleteManyPrompt,
  deleteDrawingTargets,
  deleteSectionTargets,
  editBusy,
  pathLocked,
  setDeletePrompt,
  setDeleteManyPrompt,
  deleteDocument,
  confirmDeleteMany,
}: {
  part: 'single' | 'many';
  deletePrompt: DeletionItem | null;
  deleteManyPrompt: DeletionItem[] | null;
  deleteDrawingTargets: DrawingObject[];
  deleteSectionTargets: CanvasSection[];
  editBusy: boolean;
  pathLocked: (path: string) => boolean;
  setDeletePrompt: (value: null) => void;
  setDeleteManyPrompt: (value: null) => void;
  deleteDocument: () => unknown;
  confirmDeleteMany: () => unknown;
}) {
  return (
    <>
      {part === 'many' && deleteManyPrompt && (
        <div data-ui-id="delete-many" className="dialog-backdrop">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-label="선택 문서 삭제 확인"
            className="section-dialog floating-surface"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setDeleteManyPrompt(null);
            }}
          >
            <h2>
              선택 항목{' '}
              {deleteManyPrompt.length +
                deleteDrawingTargets.length +
                deleteSectionTargets.length}
              개를 삭제할까요?
            </h2>
            <p>
              선택한 파일을 휴지통으로 이동하고 섹션의 멤버 목록에서도
              제거합니다. HTML 결과는 전용 결과 폴더 안의 모든 파일과 창
              설정·관리 문서를 함께 삭제합니다.
            </p>
            <ul>
              {deleteManyPrompt.map((doc) => (
                <li key={doc.id}>{doc.title}</li>
              ))}
              {deleteSectionTargets.map((s) => (
                <li key={s.id}>{s.title} 섹션과 내부 파일</li>
              ))}
              {!!deleteDrawingTargets.length && (
                <li>그림 {deleteDrawingTargets.length}개</li>
              )}
            </ul>
            <div className="section-dialog__actions">
              <button autoFocus onClick={() => setDeleteManyPrompt(null)}>
                취소
              </button>
              <button
                className="button-danger"
                disabled={
                  editBusy ||
                  deleteManyPrompt.some((doc) => pathLocked(doc.relativePath))
                }
                onClick={() => void confirmDeleteMany()}
              >
                선택 파일·결과 삭제
              </button>
            </div>
          </section>
        </div>
      )}

      {part === 'single' && deletePrompt && (
        <div
          data-ui-id="delete"
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
              <h2 id="delete-dialog-title">
                {isPreviewPath(deletePrompt.relativePath)
                  ? '이 HTML 결과를 삭제할까요?'
                  : '이 파일을 삭제할까요?'}
              </h2>
              <span id="delete-dialog-description">
                <strong>{deletePrompt.title}</strong> 파일을 Windows 휴지통으로
                이동합니다. 섹션에 포함되어 있다면 멤버 목록에서도 제거됩니다.
                {isPreviewPath(deletePrompt.relativePath) &&
                  ' 전용 결과 폴더 안의 모든 파일과 창 설정·관리 문서도 함께 삭제합니다.'}
              </span>
            </div>
            <div className="delete-dialog__path">
              <code>
                {isPreviewPath(deletePrompt.relativePath)
                  ? previewDeletionTarget(deletePrompt.relativePath)
                  : deletePrompt.relativePath}
              </code>
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
                disabled={pathLocked(deletePrompt.relativePath) || editBusy}
                onClick={() => void deleteDocument()}
              >
                <Trash2 size={14} /> 휴지통으로 이동
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
