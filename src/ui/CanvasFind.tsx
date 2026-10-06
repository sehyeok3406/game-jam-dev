import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { findTextRanges, type TextMatch } from '../canvas-find';

export function CanvasFind({
  close,
  jump,
  revision,
}: {
  close: () => void;
  jump: (id: string) => void;
  revision: string;
}) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<TextMatch[]>([]);
  const [index, setIndex] = useState(0);
  const latestMatches = useRef<TextMatch[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const collect = useRef<() => void>(() => {});
  const jumpRef = useRef(jump);
  jumpRef.current = jump;
  useEffect(() => {
    input.current?.focus();
  }, []);
  collect.current = () => {
    const found: TextMatch[] = [];
    for (const card of document.querySelectorAll<HTMLElement>(
      '[data-find-document]',
    )) {
      const id = card.dataset.findDocument!;
      for (const text of card.querySelectorAll<HTMLElement>(
        '.document-card__title, .document-card__collapsed-title, .markdown-body',
      ))
        found.push(...findTextRanges(text, query, id));
    }
    for (const section of document.querySelectorAll<HTMLElement>(
      '[data-find-section]',
    ))
      found.push(
        ...findTextRanges(section, query, section.dataset.findSection!),
      );
    latestMatches.current = found;
    setMatches(found);
    setIndex((current) => Math.min(current, Math.max(found.length - 1, 0)));
  };
  useEffect(() => {
    setIndex(0);
    const timer = setTimeout(() => collect.current(), 60);
    return () => clearTimeout(timer);
  }, [query, revision]);
  useEffect(() => {
    // Editors/rendered Markdown can change without a project refresh.
    const observer = new MutationObserver(() => collect.current());
    for (const card of document.querySelectorAll('[data-find-document]'))
      observer.observe(card, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    return () => observer.disconnect();
  }, [query, revision]);
  useEffect(() => {
    const highlights = CSS.highlights;
    if (!highlights || typeof Highlight === 'undefined') return;
    highlights.set(
      'canvas-find',
      new Highlight(...matches.map((match) => match.range)),
    );
    const active = matches[index];
    highlights.set(
      'canvas-find-active',
      new Highlight(...(active ? [active.range] : [])),
    );
  }, [matches, index]);
  const activeId = matches[index]?.nodeId;
  useEffect(() => {
    if (activeId) {
      jumpRef.current(activeId);
      const timer = setTimeout(() => {
        // Moving the canvas can recreate rendered Markdown nodes. Use the latest live Range,
        // and do not restart navigation whenever the DOM observer refreshes highlights.
        const active = latestMatches.current[index];
        if (!active || active.nodeId !== activeId) return;
        const element = active.range.startContainer.parentElement;
        const scroll = element?.closest<HTMLElement>(
          '.document-card__content, .document-editor',
        );
        if (scroll) {
          const bounds = active.range.getBoundingClientRect(),
            parent = scroll.getBoundingClientRect();
          // Canvas zoom scales screen pixels; convert back to scroll coordinates.
          const scale = parent.height / scroll.offsetHeight || 1;
          scroll.scrollTop +=
            (bounds.top - parent.top) / scale - scroll.clientHeight / 2;
        }
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [query, index, activeId]);
  useEffect(
    () => () => {
      CSS.highlights?.delete('canvas-find');
      CSS.highlights?.delete('canvas-find-active');
    },
    [],
  );
  const next = (delta: number) =>
    setIndex((current) =>
      matches.length ? (current + delta + matches.length) % matches.length : 0,
    );
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
      if (
        event.key === 'Escape' &&
        bar.current?.contains(document.activeElement)
      ) {
        event.preventDefault();
        close();
      }
      if (event.key === 'F3') {
        event.preventDefault();
        next(event.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [close, matches.length]);
  return (
    <div
      ref={bar}
      className="canvas-find floating-surface"
      role="search"
      aria-label="캔버스 텍스트 찾기"
    >
      <Search size={16} />
      <input
        ref={input}
        aria-label="찾을 텍스트"
        placeholder="캔버스에서 찾기"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            next(event.shiftKey ? -1 : 1);
          }
        }}
      />
      <span aria-live="polite">
        {matches.length
          ? `${index + 1} / ${matches.length}`
          : query
            ? '결과 없음'
            : '0 / 0'}
      </span>
      <button
        className="icon-button"
        disabled={!matches.length}
        title="이전 결과 (Shift+Enter)"
        onClick={() => next(-1)}
      >
        <ChevronUp size={17} />
      </button>
      <button
        className="icon-button"
        disabled={!matches.length}
        title="다음 결과 (Enter)"
        onClick={() => next(1)}
      >
        <ChevronDown size={17} />
      </button>
      <button className="icon-button" title="찾기 닫기 (Esc)" onClick={close}>
        <X size={17} />
      </button>
    </div>
  );
}
