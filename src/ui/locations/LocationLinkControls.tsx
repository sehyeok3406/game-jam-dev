import { Link2, X } from 'lucide-react';
import type { useLocationLinks } from './useLocationLinks.ts';
import './location-links.css';

export function LocationLinkControls({
  state,
}: {
  state: ReturnType<typeof useLocationLinks>;
}) {
  if (!state.available) return null;
  return (
    <div className="location-link-controls">
      <button
        type="button"
        title="공유 프로젝트 위치 링크 열기"
        aria-label="위치 링크 열기"
        onClick={() => state.setOpened(!state.opened)}
      >
        <Link2 size={16} />
      </button>
      {state.opened && (
        <section
          className="location-link-panel floating-surface"
          role="dialog"
          aria-label="위치 링크 열기"
        >
          <div className="location-link-title">
            <strong>위치 링크 열기</strong>
            <button
              type="button"
              aria-label="닫기"
              onClick={() => state.setOpened(false)}
            >
              <X size={16} />
            </button>
          </div>
          <p>참여한 공동 프로젝트의 위치 링크를 붙여넣으세요.</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void state.open();
            }}
          >
            <input
              aria-label="위치 링크"
              value={state.href}
              placeholder="gamejam://open?…"
              disabled={state.busy}
              onChange={(event) => state.setHref(event.target.value)}
            />
            <button type="submit" disabled={state.busy || !state.href.trim()}>
              {state.busy ? '확인 중…' : '이동'}
            </button>
          </form>
          {state.message && <p role="status">{state.message}</p>}
        </section>
      )}
    </div>
  );
}
