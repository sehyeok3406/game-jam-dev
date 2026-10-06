import { useEffect, useRef, useState } from 'react';
import type { ProjectEntry, ProjectFolder } from '../shared';

export type HomeDialog =
  | { type: 'rename-project' | 'move-project'; project: ProjectEntry }
  | { type: 'create-folder' }
  | { type: 'rename-folder' | 'remove-folder'; folder: ProjectFolder };

export function HomeOrganizationDialog({
  dialog,
  folders,
  busy,
  error,
  close,
  submit,
}: {
  dialog: HomeDialog;
  folders: ProjectFolder[];
  busy: boolean;
  error: string;
  close: () => void;
  submit: (value: string) => void;
}) {
  const [value, setValue] = useState(
    'project' in dialog
      ? dialog.type === 'move-project'
        ? (dialog.project.folderId ?? '')
        : dialog.project.name
      : 'folder' in dialog
        ? dialog.folder.name
        : '',
  );
  const ref = useRef<HTMLFormElement>(null);
  const latest = useRef({ close, busy });
  latest.current = { close, busy };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,select,button')?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!latest.current.busy) latest.current.close();
      }
      if (event.key !== 'Tab') return;
      const items = [
        ...(ref.current?.querySelectorAll<HTMLElement>(
          'input:not(:disabled),select:not(:disabled),button:not(:disabled)',
        ) ?? []),
      ];
      const first = items[0],
        last = items.at(-1);
      if (
        (event.shiftKey && document.activeElement === first) ||
        (!event.shiftKey && document.activeElement === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const titles = {
    'rename-project': '프로젝트 이름 변경',
    'move-project': '홈 폴더로 이동',
    'create-folder': '새 홈 폴더',
    'rename-folder': '폴더 이름 변경',
    'remove-folder': '홈 폴더 삭제',
  };
  return (
    <div className="modal-backdrop">
      <form
        ref={ref}
        className="modal-card home-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-organization-title"
        aria-describedby="home-organization-description"
        onSubmit={(event) => {
          event.preventDefault();
          submit(value);
        }}
      >
        <h2 id="home-organization-title">{titles[dialog.type]}</h2>
        <p id="home-organization-description">
          {dialog.type === 'rename-project'
            ? 'project' in dialog && dialog.project.kind === 'shared'
              ? '관리자만 서버에 연결해 실제 공동 프로젝트 이름을 변경할 수 있습니다. 다른 팀원에게도 반영됩니다. 서버 저장 경로와 프로젝트 ID는 유지합니다.'
              : '실제 로컬 프로젝트 이름과 project.md의 제목을 변경합니다. 저장 폴더 경로와 문서 본문은 유지하며 별도의 공동 사본은 바뀌지 않습니다.'
            : dialog.type === 'remove-folder'
              ? `“${'folder' in dialog ? dialog.folder.name : ''}” 분류를 삭제합니다. 프로젝트는 전체 목록에 남으며 파일과 공동 세션은 삭제되지 않습니다.`
              : '이 PC의 홈에서 프로젝트를 정리하는 분류입니다. 실제 파일이나 서버 데이터를 이동하지 않습니다.'}
        </p>
        {dialog.type !== 'remove-folder' && (
          <label>
            {dialog.type === 'move-project' ? '분류 폴더' : '이름'}
            {dialog.type === 'move-project' ? (
              <select
                disabled={busy}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              >
                <option value="">분류하지 않음</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                disabled={busy}
                required
                maxLength={100}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            )}
          </label>
        )}
        {error && (
          <p className="home-error" role="alert">
            {error}
          </p>
        )}
        <div className="home-dialog-actions">
          <button type="button" disabled={busy} onClick={close}>
            취소
          </button>
          <button className="button-primary" disabled={busy}>
            {busy
              ? '저장 중…'
              : dialog.type === 'remove-folder'
                ? '분류만 삭제'
                : '저장'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function HomeContextMenu({
  x,
  y,
  origin,
  items,
  close,
}: {
  x: number;
  y: number;
  origin: HTMLElement;
  items: {
    label: string;
    disabled?: boolean;
    title?: string;
    action: () => void;
  }[];
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) latest.current();
    };
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') event.preventDefault();
        latest.current();
      }
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', dismiss);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', dismiss);
      if (origin.isConnected) origin.focus();
    };
  }, [origin]);
  return (
    <div
      ref={ref}
      className="home-context-menu"
      role="menu"
      aria-label="홈 항목 메뉴"
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - 244)),
        top: Math.max(
          8,
          Math.min(y, window.innerHeight - (items.length * 42 + 16)),
        ),
      }}
      onKeyDown={(event) => {
        const buttons = [
          ...(ref.current?.querySelectorAll<HTMLButtonElement>(
            'button:not(:disabled)',
          ) ?? []),
        ];
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        let target = index;
        if (event.key === 'ArrowDown') target = (index + 1) % buttons.length;
        else if (event.key === 'ArrowUp')
          target = (index + buttons.length - 1) % buttons.length;
        else if (event.key === 'Home') target = 0;
        else if (event.key === 'End') target = buttons.length - 1;
        else return;
        event.preventDefault();
        buttons[target]?.focus();
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          disabled={item.disabled}
          title={item.title}
          onClick={() => {
            close();
            item.action();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
