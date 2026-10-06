import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Code2,
  FileText,
  Frame,
  Image,
  Search,
  StickyNote,
  X,
} from 'lucide-react';
import { SHORTCUTS } from '../canvas-ux';
import { PREVIEW_PRESETS } from '../preview-window';
import { previewLabel } from '../preview-output';
import type { PreviewResult } from '../shared';

export type CanvasItem = {
  id: string;
  title: string;
  kind:
    | 'idea'
    | 'document'
    | 'section'
    | 'html'
    | 'task'
    | 'image'
    | 'reference';
  path: string;
  description: string;
  parent?: string;
  editingBy?: string;
};
export type CanvasCommand = {
  id: string;
  title: string;
  shortcut?: string;
  disabled?: boolean;
  reason?: string;
  run: () => void;
};
const icon = (kind: CanvasItem['kind']) =>
  kind === 'image' ? (
    <Image size={16} />
  ) : kind === 'section' ? (
    <Frame size={16} />
  ) : kind === 'html' ? (
    <Code2 size={16} />
  ) : kind === 'idea' ? (
    <StickyNote size={16} />
  ) : (
    <FileText size={16} />
  );
export const ITEM_LABELS = {
  image: '이미지',
  reference: '참고 문서',
  idea: '아이디어',
  document: '정리 문서',
  section: '섹션',
  html: 'HTML 결과',
  task: 'AI 작업',
};
const match = (item: CanvasItem, query: string) =>
  `${item.title} ${item.path} ${item.description}`
    .toLocaleLowerCase()
    .includes(query.toLocaleLowerCase());

function useModalFocus() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusable = () => [
      ...(ref.current?.querySelectorAll<HTMLElement>(
        'input:not(:disabled),button:not(:disabled),select:not(:disabled),[tabindex="0"]',
      ) ?? []),
    ];
    focusable()[0]?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusable(),
        first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    ref.current?.addEventListener('keydown', handle);
    const element = ref.current;
    return () => {
      element?.removeEventListener('keydown', handle);
      previous?.focus();
    };
  }, []);
  return ref;
}

export function CanvasNavigator({
  items,
  jump,
  close,
}: {
  items: CanvasItem[];
  jump: (id: string) => void;
  close: () => void;
}) {
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all');
  const visible = items.filter(
    (item) => (filter === 'all' || item.kind === filter) && match(item, query),
  );
  return (
    <aside className="canvas-navigator floating-surface" aria-label="문서 탐색">
      <header>
        <strong>캔버스 탐색</strong>
        <button className="icon-button" title="탐색 닫기" onClick={close}>
          <X size={16} />
        </button>
      </header>
      <label className="ux-search">
        <Search size={16} />
        <input
          aria-label="문서 목록 검색"
          placeholder="제목·내용 검색"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="ux-filter-tabs">
        {[
          ['all', '전체'],
          ['idea', '메모'],
          ['document', '문서'],
          ['image', '이미지'],
          ['reference', '참고'],
          ['section', '섹션'],
          ['html', 'HTML'],
          ['task', '작업'],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="navigator-items">
        {visible.map((item) => (
          <button
            key={item.id}
            onClick={() => jump(item.id)}
            className={
              item.parent
                ? 'navigator-item navigator-item--member'
                : 'navigator-item'
            }
            title={`${item.path}${item.parent ? ` · ${item.parent}` : ''}`}
          >
            {icon(item.kind)}
            <span>
              <strong>{item.title}</strong>
              <small>
                {item.editingBy
                  ? `${item.editingBy}님 편집 중`
                  : (item.parent ?? ITEM_LABELS[item.kind])}
              </small>
            </span>
          </button>
        ))}
        {!visible.length && <p className="ux-empty">검색 결과가 없습니다.</p>}
      </div>
      <footer>{visible.length}개 항목 · 항목을 눌러 위치로 이동</footer>
    </aside>
  );
}

export function CommandPalette({
  items,
  commands,
  jump,
  close,
}: {
  items: CanvasItem[];
  commands: CanvasCommand[];
  jump: (id: string) => void;
  close: () => void;
}) {
  const ref = useModalFocus(),
    [query, setQuery] = useState(''),
    [index, setIndex] = useState(0);
  const results = useMemo(
    () =>
      [
        ...commands
          .filter((command) =>
            command.title.toLowerCase().includes(query.toLowerCase()),
          )
          .map((command) => ({
            id: `command:${command.id}`,
            title: command.title,
            detail: command.disabled ? command.reason : command.shortcut,
            disabled: command.disabled,
            run: () => {
              if (!command.disabled) {
                close();
                command.run();
              }
            },
            type: '기능',
          })),
        ...items
          .filter((item) => match(item, query))
          .map((item) => ({
            id: item.id,
            title: item.title,
            detail: item.parent ?? ITEM_LABELS[item.kind],
            disabled: false,
            run: () => {
              close();
              jump(item.id);
            },
            type: '문서',
          })),
      ].slice(0, 60),
    [commands, items, query, close, jump],
  );
  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    ref.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [index, ref]);
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="검색 및 명령"
        className="command-palette floating-surface"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            close();
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIndex((value) =>
              Math.max(0, Math.min(results.length - 1, value + 1)),
            );
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setIndex((value) => Math.max(0, value - 1));
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            results[index]?.run();
          }
        }}
      >
        <label className="ux-search">
          <Search size={20} />
          <input
            autoFocus
            role="combobox"
            aria-label="검색 및 명령 입력"
            aria-expanded="true"
            aria-controls="command-results"
            aria-activedescendant={results[index]?.id}
            placeholder="문서·섹션 찾기 또는 기능 검색…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>Esc</kbd>
        </label>
        <div id="command-results" role="listbox" aria-label="검색 결과">
          {results.map((result, position) => (
            <button
              id={result.id}
              role="option"
              aria-selected={index === position}
              aria-disabled={result.disabled}
              key={result.id}
              onMouseEnter={() => setIndex(position)}
              onClick={result.run}
            >
              <span>
                <small>{result.type}</small>
                <strong>{result.title}</strong>
              </span>
              <small>{result.detail}</small>
            </button>
          ))}
          {!results.length && <p className="ux-empty">검색 결과가 없습니다.</p>}
        </div>
        <footer>
          ↑ ↓ 선택 · Enter 실행 · 문서 편집·게임 플레이에서는 단축키가 적용되지
          않습니다.
        </footer>
      </section>
    </div>
  );
}

export function ShortcutDialog({ close }: { close: () => void }) {
  const ref = useModalFocus();
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="단축키 안내"
        className="shortcut-dialog floating-surface"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            close();
          }
        }}
      >
        <header>
          <div>
            <span className="eyebrow">WORK FASTER</span>
            <h2>캔버스 단축키</h2>
          </div>
          <button
            className="icon-button"
            title="단축키 안내 닫기"
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>
        <p>
          텍스트 입력 중에는 기본 텍스트 단축키가 우선합니다. Mac에서는 Ctrl
          대신 ⌘를 사용하세요.
        </p>
        <div className="shortcut-list">
          {SHORTCUTS.map(([label, keys]) => (
            <div key={label}>
              <span>{label}</span>
              <kbd>{keys}</kbd>
            </div>
          ))}
        </div>
        <small>
          메모·파일 창은 최소화하거나 삭제할 수 있습니다. 실행 취소는 이 앱
          세션의 본인 작업만 되돌리며, 이후 변경과 충돌하면 중단합니다.
        </small>
      </section>
    </div>
  );
}

export function CompareDialog({
  previews,
  first,
  onCompare,
  close,
}: {
  previews: PreviewResult[];
  first?: string;
  onCompare: (a: string, b: string, preset: string) => Promise<void>;
  close: () => void;
}) {
  const ref = useModalFocus(),
    [a, setA] = useState(first ?? previews[0]?.relativePath ?? ''),
    [b, setB] = useState(
      previews.find(
        (item) => item.relativePath !== (first ?? previews[0]?.relativePath),
      )?.relativePath ?? '',
    ),
    [preset, setPreset] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <div className="dialog-backdrop">
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="HTML 버전 비교"
        className="compare-dialog floating-surface"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.stopPropagation();
            close();
          }
        }}
      >
        <header>
          <h2>HTML 버전 비교</h2>
          <button
            className="icon-button"
            title="비교 닫기"
            disabled={busy}
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>
        <p>
          두 결과 창을 나란히 배치합니다. 게임은 새로 시작하지 않으며 파일
          내용은 바꾸지 않습니다.
        </p>
        {previews.length < 2 ? (
          <p className="ux-empty">
            비교하려면 HTML 구현에서 새 버전을 하나 더 만들어주세요.
          </p>
        ) : (
          <>
            <div className="compare-fields">
              {[
                [a, setA, '왼쪽 결과'],
                [b, setB, '오른쪽 결과'],
              ].map(([value, setter, label]) => (
                <label key={label as string}>
                  {label as string}
                  <select
                    aria-label={label as string}
                    disabled={busy}
                    value={value as string}
                    onChange={(event) =>
                      (setter as (value: string) => void)(event.target.value)
                    }
                  >
                    {previews.map((result) => (
                      <option
                        key={result.relativePath}
                        value={result.relativePath}
                      >
                        {previewLabel(result.relativePath)} ·{' '}
                        {result.relativePath}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <label>
              테스트 해상도
              <select
                aria-label="비교 테스트 해상도"
                value={preset}
                disabled={busy}
                onChange={(event) => setPreset(event.target.value)}
              >
                <option value="">각 창의 기존 해상도 유지</option>
                {PREVIEW_PRESETS.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.device} · {item.ratio} · {item.width} × {item.height}
                  </option>
                ))}
              </select>
            </label>
            {error && (
              <p role="alert" className="history-error">
                {error}
              </p>
            )}
            <button
              className="button-primary"
              disabled={busy || !a || !b || a === b}
              onClick={async () => {
                setBusy(true);
                try {
                  await onCompare(a, b, preset);
                  close();
                } catch (error) {
                  setError(
                    error instanceof Error ? error.message : String(error),
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? '배치 중…' : '나란히 비교하기'}
            </button>
          </>
        )}
      </section>
    </div>
  );
}
