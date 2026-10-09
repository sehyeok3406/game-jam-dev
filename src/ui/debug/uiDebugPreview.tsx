import { createRoot } from 'react-dom/client';
import { App } from '../App';
import { createUiPreviewApi } from './uiDebugFixtures';
import { UI_DEBUG_ENTRIES, validUiDebugSelection } from './uiDebugRegistry';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(String(key)) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(String(key));
    },
    setItem: (key, value) => {
      values.set(String(key), String(value));
    },
  };
}
export async function bootstrapUiDebugPreview(raw: string) {
  if (window.parent === window || window.gameCanvas)
    throw Error('UI 미리보기는 디버깅 콘솔 안에서만 사용할 수 있습니다.');
  const selection: unknown = JSON.parse(raw);
  if (!validUiDebugSelection(selection))
    throw Error('UI 미리보기 항목을 확인해주세요.');
  const send = (data: object) => window.parent.postMessage(data, '*');
  const blocked = (method: string) =>
    send({ type: 'ui-debug:blocked', method });
  Object.defineProperty(window, 'uiDebugPreview', { value: selection });
  Object.defineProperty(window, 'gameCanvas', {
    value: createUiPreviewApi(selection, blocked),
  });
  Object.defineProperty(window, 'localStorage', { value: memoryStorage() });
  Object.defineProperty(window, 'sessionStorage', { value: memoryStorage() });
  localStorage.setItem('game-canvas-theme', selection.theme);
  if (
    ['home', 'home-controls', 'home-project'].includes(selection.id) &&
    selection.state === 'list'
  )
    localStorage.setItem(
      'game-canvas-home-view',
      JSON.stringify({ view: 'list' }),
    );
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: async () => blocked('clipboard'),
      readText: async () => '',
    },
  });
  window.open = () => {
    blocked('window.open');
    return null;
  };
  window.fetch = async () => {
    blocked('fetch');
    throw Error('미리보기에서는 외부 요청을 실행하지 않습니다.');
  };
  const policy = document.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content =
    "connect-src 'none'; img-src 'self' data: blob:; form-action 'none';";
  document.head.append(policy);
  document.addEventListener(
    'click',
    (event) => {
      if ((event.target as Element | null)?.closest('a[href]')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        blocked('navigation');
      }
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'F12') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) send({ type: 'ui-debug:toggle' });
      }
    },
    true,
  );
  window.addEventListener('error', (event) =>
    send({ type: 'ui-debug:error', message: event.message }),
  );
  window.addEventListener('unhandledrejection', (event) => {
    event.preventDefault();
    send({ type: 'ui-debug:error', message: String(event.reason) });
  });
  const root = document.getElementById('root');
  if (!root) throw Error('UI 미리보기 영역을 찾을 수 없습니다.');
  createRoot(root).render(<App preview={selection} />);
  const selected = UI_DEBUG_ENTRIES.find((entry) => entry.id === selection.id)!;
  const style = document.createElement('style');
  style.textContent =
    '.ui-preview-selected{outline:3px solid #a8dd6c!important;outline-offset:3px;}';
  document.head.append(style);
  const deadline = performance.now() + 10000;
  const find = () => {
    const targets = [
      ...document.querySelectorAll<HTMLElement>(selected.selector),
    ].filter((target) => target.getClientRects().length);
    if (targets.length) {
      if (selection.id === 'preview' && selection.state === 'settings')
        document.querySelector<HTMLElement>('.preview-settings')?.showPopover();
      if (selection.id === 'selection' && selection.state === 'arrange')
        document
          .querySelector('.selection-arrange-menu')
          ?.setAttribute('open', '');
      for (const target of targets) target.classList.add('ui-preview-selected');
      send({ type: 'ui-debug:ready', found: true });
      return;
    }
    if (performance.now() > deadline) {
      send({ type: 'ui-debug:ready', found: false });
      return;
    }
    setTimeout(find, 80);
  };
  setTimeout(find, 150);
}
