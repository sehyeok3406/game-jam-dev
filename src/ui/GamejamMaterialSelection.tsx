import { useEffect, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { materialNavigation, nextMaterial } from '../gamejam-materials';

export function GamejamMaterialSelection({
  items,
  paths,
  focused,
  focus,
  toggle,
  finish,
  cancel,
}: {
  items: { id: string; path: string; title: string }[];
  paths: string[];
  focused: string | null;
  focus: (id: string) => void;
  toggle: (path: string) => void;
  finish: () => void;
  cancel: () => void;
}) {
  const flow = useReactFlow();
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const canvas = document.querySelector<HTMLElement>('.canvas-shell');
    const controls = [
      ...document.querySelectorAll<HTMLElement>(
        '.floating-header, .canvas-dock, .bottom-toolbar, .canvas-utility, .selection-context, .object-inspector',
      ),
    ].map((element) => ({ element, inert: element.inert }));
    controls.forEach(({ element }) => {
      element.inert = true;
    });
    canvas?.focus({ preventScroll: true });
    return () => {
      controls.forEach(({ element, inert }) => {
        element.inert = inert;
      });
    };
  }, []);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target =
        event.target instanceof HTMLElement
          ? event.target
          : (document.activeElement as HTMLElement | null);
      if (target?.closest('input, textarea, select, [contenteditable="true"]'))
        return;
      if (event.key === 'Tab') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const controls = [
          ...document.querySelectorAll<HTMLElement>(
            '.material-selection-bar button, .canvas-tabs [role="tab"]',
          ),
        ];
        const index = controls.indexOf(document.activeElement as HTMLElement);
        controls[
          (index + (event.shiftKey ? controls.length - 1 : 1)) % controls.length
        ]?.focus();
        return;
      }
      // This mode owns canvas shortcuts, including Space, Delete and drawing tools.
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
        return;
      }
      const action = materialNavigation(event);
      if (!action) return;
      if (action === 'toggle' && target?.closest('button')) return;
      event.preventDefault();
      if (action === 'toggle') {
        const item = items.find((item) => item.id === focused);
        if (item && !event.repeat) toggle(item.path);
        return;
      }
      const nodes = flow.getNodes();
      const positions = items.flatMap((item) => {
        const node = nodes.find((node) => node.id === item.id);
        if (!node || node.hidden || node.selectable === false) return [];
        const parent = nodes.find((parent) => parent.id === node.parentId);
        return [
          {
            id: item.id,
            x:
              node.position.x +
              (parent?.position.x ?? 0) +
              (node.measured?.width ?? Number(node.style?.width ?? 340)) / 2,
            y:
              node.position.y +
              (parent?.position.y ?? 0) +
              (node.measured?.height ?? Number(node.style?.height ?? 300)) / 2,
          },
        ];
      });
      const bounds = document
        .querySelector('.react-flow')
        ?.getBoundingClientRect();
      const origin = flow.screenToFlowPosition({
        x: (bounds?.left ?? 0) + (bounds?.width ?? 0) / 2,
        y: (bounds?.top ?? 0) + (bounds?.height ?? 0) / 2,
      });
      const id = nextMaterial(positions, focused, action, origin);
      const point = positions.find((item) => item.id === id);
      if (id && point) {
        focus(id);
        document
          .querySelector<HTMLElement>('.canvas-shell')
          ?.focus({ preventScroll: true });
        void flow.setCenter(point.x, point.y, {
          zoom: flow.getZoom(),
          duration: 160,
        });
      }
    };
    const pointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (
        !target.closest('.canvas-shell, .canvas-tabs, .material-selection-bar')
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', keyboard, true);
    window.addEventListener('pointerdown', pointer, true);
    return () => {
      window.removeEventListener('keydown', keyboard, true);
      window.removeEventListener('pointerdown', pointer, true);
    };
  }, [flow, items, paths, focused, focus, toggle, finish, cancel]);
  return (
    <div
      ref={bar}
      className="material-selection-bar floating-surface"
      role="region"
      aria-label="AI 자료 선택"
    >
      <div>
        <strong>AI가 참고할 자료를 선택하세요</strong>
        <small>
          클릭·드래그로 여러 개 선택 · 방향키/WASD로 탐색 · Space로 선택·해제
        </small>
        <span role="status">
          {items.find((item) => item.id === focused)?.title ??
            '다른 캔버스에서도 자료를 고를 수 있어요.'}
        </span>
      </div>
      <button type="button" onClick={cancel}>
        취소
      </button>
      <button type="button" className="button-primary" onClick={finish}>
        선택 완료 · {paths.length}개
      </button>
    </div>
  );
}
