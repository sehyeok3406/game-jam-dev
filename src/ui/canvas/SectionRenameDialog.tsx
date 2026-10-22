import type { SectionRenamePrompt } from './section-actions';

export function SectionRenameDialog({
  prompt,
  busy,
  locked,
  change,
  close,
  confirm,
}: {
  prompt: SectionRenamePrompt | null;
  busy: boolean;
  locked: boolean;
  change: (title: string) => void;
  close: () => void;
  confirm: () => void;
}) {
  if (!prompt) return null;
  return (
    <div data-ui-id="section-rename" className="dialog-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="섹션 이름 변경"
        className="section-dialog floating-surface"
        onKeyDown={(event) => {
          if (event.key === 'Escape') close();
        }}
      >
        <h2>섹션 이름 변경</h2>
        <input
          autoFocus
          aria-label="새 섹션 이름"
          maxLength={120}
          value={prompt.title}
          disabled={busy}
          onChange={(event) => change(event.target.value)}
        />
        <p>파일 경로와 문서 ID, 포함된 파일은 유지됩니다.</p>
        <div className="section-dialog__actions">
          <button disabled={busy} onClick={close}>
            취소
          </button>
          <button
            className="button-primary"
            disabled={busy || locked || !prompt.title.trim()}
            onClick={confirm}
          >
            이름 변경
          </button>
        </div>
      </section>
    </div>
  );
}
