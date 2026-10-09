import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { uiPreview } from './uiDebugPreviewState';
import { uiDebugEntries, type UiDebugScope } from './uiDebugRegistry';
import './ui-debug.css';

export function UiDebugConsole({
  scope,
  theme,
}: {
  scope: UiDebugScope;
  theme: 'dark' | 'light';
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [state, setState] = useState('default');
  const [mode, setMode] = useState<'preview' | 'highlight'>('preview');
  const [previewTheme, setPreviewTheme] = useState(theme);
  const [viewport, setViewport] = useState('1280');
  const [message, setMessage] = useState('');
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const [rects, setRects] = useState<DOMRect[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(800);
  const previousFocus = useRef<HTMLElement | null>(null);
  const isPreview = !!uiPreview();
  const entries = uiDebugEntries(scope);
  const selected =
    entries.find((item) => item.id === selectedId) ??
    entries.find((item) => item.id === (scope === 'home' ? 'home' : 'canvas'))!;
  const selectedState = selected.states.includes(state)
    ? state
    : selected.states[0];
  const visible = entries.filter(
    (item) =>
      (group === 'all' || item.group === group) &&
      `${item.label} ${item.code} ${item.source}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );

  useEffect(() => {
    if (isPreview) return;
    const toggle = () => setOpen((value) => !value);
    const unsubscribe = window.gameCanvas.onUiDebugToggle?.(toggle);
    const key = (event: KeyboardEvent) => {
      if (event.key === 'F12' && !unsubscribe) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) toggle();
      } else if (event.key === 'Escape' && dialog.current?.open) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setOpen(false);
      }
    };
    const fromFrame = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data;
      if (data?.type === 'ui-debug:toggle') toggle();
      if (data?.type === 'ui-debug:blocked')
        setMessage(
          `미리보기: 실제 작업은 실행하지 않았습니다. (${data.method})`,
        );
      if (data?.type === 'ui-debug:ready') {
        setReady(true);
        setMessage((current) =>
          current && current !== '미리보기를 불러오는 중…'
            ? current
            : data.found
              ? '샘플 데이터 · 실행 동작 차단됨'
              : '이 상태의 UI가 표시되지 않았습니다. 다시 표시를 눌러주세요.',
        );
      }
      if (data?.type === 'ui-debug:error') {
        setReady(true);
        setMessage(`미리보기 오류: ${data.message}`);
      }
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('message', fromFrame);
    return () => {
      unsubscribe?.();
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('message', fromFrame);
    };
  }, [isPreview]);

  useEffect(() => {
    setSelectedId('');
    setState('default');
    setQuery('');
    setGroup('all');
    setMode('preview');
    setMessage('');
    setRects([]);
  }, [scope]);
  useLayoutEffect(() => {
    if (!open || isPreview) return;
    const element = dialog.current;
    if (!element) return;
    previousFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    element.showModal();
    element.querySelector<HTMLInputElement>('input')?.focus();
    return () => {
      element.close();
      previousFocus.current?.focus({ preventScroll: true });
    };
  }, [open, isPreview]);
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element || !open || mode !== 'preview') return;
    const observer = new ResizeObserver(() =>
      setStageWidth(element.clientWidth - 24),
    );
    observer.observe(element);
    setStageWidth(element.clientWidth - 24);
    return () => observer.disconnect();
  }, [open, mode]);
  useEffect(() => {
    if (!open || mode !== 'highlight') {
      setRects([]);
      return;
    }
    const update = () => {
      const matches = [
        ...document.querySelectorAll<HTMLElement>(selected.selector),
      ]
        .filter(
          (element) =>
            !dialog.current?.contains(element) &&
            element.getClientRects().length,
        )
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width && rect.height);
      setRects(matches);
      setMessage(
        matches.length
          ? `${matches.length}개 표시 영역 강조 중`
          : '현재 화면에는 표시되지 않은 UI입니다. 미리보기로 확인하세요.',
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(document.documentElement);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, mode, selected.id, selected.selector, scope]);
  useEffect(() => {
    if (mode !== 'preview') return;
    setReady(false);
    setMessage('미리보기를 불러오는 중…');
  }, [
    open,
    selected.id,
    selectedState,
    previewTheme,
    viewport,
    revision,
    mode,
  ]);
  if (!open || isPreview) return null;

  const width = Number(viewport);
  const height = width < 600 ? 844 : 900;
  const scale = Math.min(1, Math.max(0.15, stageWidth / width));
  const url = import.meta.env.DEV
    ? new URL('/index.html', window.location.href)
    : new URL('../index.html', import.meta.url);
  url.searchParams.set(
    'uiDebugPreview',
    JSON.stringify({
      id: selected.id,
      state: selectedState,
      scope,
      theme: previewTheme,
    }),
  );
  const choose = (id: string, preview: boolean) => {
    const item = entries.find((entry) => entry.id === id)!;
    setSelectedId(id);
    setState(item.states[0]);
    setMode(preview ? 'preview' : 'highlight');
    setRevision((value) => value + 1);
  };
  return createPortal(
    <dialog
      ref={dialog}
      className={`ui-debug-console${mode === 'highlight' ? ' ui-debug-console--highlight' : ''}`}
      aria-label={scope === 'home' ? '홈 UI 디버깅' : '프로젝트 UI 디버깅'}
      onCancel={(event) => {
        event.preventDefault();
        setOpen(false);
      }}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <header className="ui-debug-heading">
        <div>
          <strong>
            {scope === 'home' ? '홈 UI 디버깅' : '프로젝트 UI 디버깅'}
          </strong>
          <small>실제 코드로 UI 확인 · 샘플 전용</small>
        </div>
        <button onClick={() => setOpen(false)} aria-label="UI 디버깅 닫기">
          닫기 <kbd>F12</kbd>
        </button>
      </header>
      <div className="ui-debug-body">
        <aside className="ui-debug-list">
          <input
            aria-label="UI 검색"
            placeholder="이름 · 코드 · 경로 검색"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            aria-label="UI 분류"
            value={group}
            onChange={(event) => setGroup(event.target.value)}
          >
            <option value="all">이 화면의 전체 UI</option>
            {[...new Set(entries.map((item) => item.group))].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <p className="ui-debug-count">
            {visible.length} / {entries.length}개 UI
          </p>
          <div className="ui-debug-items">
            {visible.map((item) => (
              <article
                key={item.id}
                data-debug-entry={item.id}
                className={selected.id === item.id ? 'is-selected' : ''}
              >
                <strong>{item.label}</strong>
                <code>{item.code}</code>
                <div>
                  <button onClick={() => choose(item.id, true)}>
                    미리보기
                  </button>
                  <button onClick={() => choose(item.id, false)}>강조</button>
                </div>
              </article>
            ))}
            {!visible.length && <p>검색 결과가 없습니다.</p>}
          </div>
        </aside>
        {mode === 'preview' && (
          <section className="ui-debug-detail">
            <div className="ui-debug-metadata">
              <strong>{selected.label}</strong>
              <code>{selected.code}</code>
              <small>{selected.source}</small>
            </div>
            <div className="ui-debug-options">
              <label>
                상태
                <select
                  aria-label="미리보기 상태"
                  value={selectedState}
                  onChange={(event) => setState(event.target.value)}
                >
                  {selected.states.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                테마
                <select
                  aria-label="미리보기 테마"
                  value={previewTheme}
                  onChange={(event) =>
                    setPreviewTheme(event.target.value as 'light' | 'dark')
                  }
                >
                  <option value="dark">다크</option>
                  <option value="light">라이트</option>
                </select>
              </label>
              <label>
                화면
                <select
                  aria-label="미리보기 화면 크기"
                  value={viewport}
                  onChange={(event) => setViewport(event.target.value)}
                >
                  <option value="1280">1280 × 900</option>
                  <option value="1024">1024 × 900</option>
                  <option value="390">390 × 844</option>
                </select>
              </label>
              <button onClick={() => setRevision((value) => value + 1)}>
                다시 표시
              </button>
              <button
                onClick={() => {
                  void window.gameCanvas
                    .copyText(
                      `${selected.code} / ${selectedState} / ${selected.source}`,
                    )
                    .then(() => setMessage('식별 정보를 복사했습니다.'))
                    .catch(() =>
                      setMessage('식별 정보를 복사하지 못했습니다.'),
                    );
                }}
              >
                식별 정보 복사
              </button>
            </div>
            <div className="ui-debug-stage" ref={stage}>
              <div
                style={{ width: width * scale, height: height * scale }}
                className="ui-debug-frame-space"
              >
                <iframe
                  key={`${url.href}:${revision}`}
                  ref={frame}
                  title={`${selected.code} 미리보기`}
                  src={url.href}
                  sandbox="allow-scripts allow-same-origin"
                  style={{ width, height, transform: `scale(${scale})` }}
                />
              </div>
              {!ready && (
                <span className="ui-debug-loading">
                  UI를 준비하고 있습니다…
                </span>
              )}
            </div>
          </section>
        )}
      </div>
      <footer className="ui-debug-message" role="status">
        {message}
      </footer>
      {mode === 'highlight' &&
        rects.map((rect, index) => (
          <div
            key={index}
            className="ui-debug-highlight"
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            }}
          >
            <span>{selected.code}</span>
          </div>
        ))}
    </dialog>,
    document.body,
  );
}
