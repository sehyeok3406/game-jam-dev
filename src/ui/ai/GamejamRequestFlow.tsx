import type { ReactNode, RefObject } from 'react';
import { X } from 'lucide-react';
import { GamejamProgress } from '../GamejamWizard';
import type { GamejamRequest } from '../../contracts/gamejam-request';
import type { GamejamDraft } from '../../gamejam-history';
import type { GamejamPage } from '../../gamejam-wizard';

type FlowProps = {
  request: Pick<GamejamRequest, 'organize' | 'implement'>;
  busy: boolean;
  close: () => void;
  dialogRef: RefObject<HTMLElement | null>;
  history: {
    loading: boolean;
    draft: GamejamDraft | null;
    status: string;
    restore: () => void;
    recent: () => Promise<void>;
    open: () => void;
  };
  wizard: {
    page: GamejamPage;
    visited: number;
    navigate: (page: GamejamPage) => void;
  };
  children: ReactNode;
};
/** The request dialog owns dismissal, history actions and wizard chrome. */
export function GamejamRequestFlow({
  request,
  busy,
  close,
  dialogRef,
  history,
  wizard,
  children,
}: FlowProps) {
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) close();
      }}
    >
      <section
        ref={dialogRef}
        className={`ai-request-dialog floating-surface${request.organize && request.implement ? ' ai-request-dialog--combined' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-request-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.stopPropagation();
            close();
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
            disabled={busy}
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>
        <div
          className="gamejam-request-history"
          aria-label="작업 요청 불러오기"
        >
          <div className="gamejam-request-history__actions">
            <button
              type="button"
              disabled={busy || history.loading || !history.draft}
              onClick={history.restore}
            >
              작성 중 요청 불러오기
            </button>
            <button
              type="button"
              disabled={busy || history.loading}
              onClick={() => void history.recent()}
            >
              {history.loading ? '불러오는 중…' : '최근 작업 불러오기'}
            </button>
            <button
              type="button"
              disabled={busy || history.loading}
              onClick={history.open}
            >
              작업 기록
            </button>
          </div>
          <small role="status">
            {history.status}
            {history.draft
              ? ` · 저장된 초안 ${new Date(history.draft.updatedAt).toLocaleString('ko-KR')}`
              : ''}
          </small>
        </div>
        <GamejamProgress
          page={wizard.page}
          visited={wizard.visited}
          busy={busy}
          navigate={wizard.navigate}
        />

        {children}
      </section>
    </div>
  );
}
