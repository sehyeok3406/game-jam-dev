import { Frame, Trash2, Ungroup } from 'lucide-react';
import type { CanvasDocument } from '../../contracts/documents';
import type { CanvasSection } from '../../contracts/canvas';
import type { MembershipPrompt, SectionActionPrompt } from './section-actions';

type Props = {
  sectionDialogOpen: boolean;
  sectionTitle: string;
  createDocuments: CanvasDocument[];
  setSectionDialogOpen: (open: boolean) => void;
  setSectionTitle: (title: string) => void;
  createSectionFromSelection: () => void;
  membershipPrompt: MembershipPrompt | null;
  cancelMembershipChange: () => void;
  confirmMembershipChange: () => void;
  sectionActionPrompt: SectionActionPrompt | null;
  setSectionActionPrompt: (value: SectionActionPrompt | null) => void;
  confirmSectionAction: () => void;
  sectionLocked: (section: CanvasSection) => boolean;
  pathLocked: (path: string) => boolean;
  busy: boolean;
};
export function SectionDialogs({
  sectionDialogOpen,
  sectionTitle,
  createDocuments,
  setSectionDialogOpen,
  setSectionTitle,
  createSectionFromSelection,
  membershipPrompt,
  cancelMembershipChange,
  confirmMembershipChange,
  sectionActionPrompt,
  setSectionActionPrompt,
  confirmSectionAction,
  sectionLocked,
  pathLocked,
  busy,
}: Props) {
  const membershipLocked =
    !!membershipPrompt &&
    [
      membershipPrompt.document.relativePath,
      ...[membershipPrompt.fromSection, membershipPrompt.toSection].flatMap(
        (section) => (section ? [section.relativePath] : []),
      ),
    ].some(pathLocked);
  return (
    <>
      {sectionDialogOpen && (
        <div
          data-ui-id="section-create"
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
                disabled={busy}
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
              {createDocuments.map((document) => (
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
                disabled={
                  busy ||
                  !createDocuments.length ||
                  createDocuments.some((doc) => pathLocked(doc.relativePath))
                }
                onClick={() => void createSectionFromSelection()}
              >
                <Frame size={15} /> {createDocuments.length}개 파일 묶기
              </button>
            </div>
          </section>
        </div>
      )}

      {membershipPrompt && (
        <div
          data-ui-id="membership"
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
                disabled={busy}
                onClick={() => void cancelMembershipChange()}
              >
                취소
              </button>
              <button
                type="button"
                className="button-primary"
                disabled={busy || membershipLocked}
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
          data-ui-id="section-action"
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
                disabled={busy || sectionLocked(sectionActionPrompt.section)}
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
    </>
  );
}
