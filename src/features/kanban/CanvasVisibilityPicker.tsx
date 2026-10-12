import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import type { CanvasSheet } from '../../shared';
import type { KanbanLayouts } from './preferences';

export function CanvasVisibilityPicker({
  value,
  canvases,
  change,
}: {
  value: NonNullable<KanbanLayouts['visibility']>;
  canvases: CanvasSheet[];
  change: (value: NonNullable<KanbanLayouts['visibility']>) => void;
}) {
  const id = useId(),
    trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState({ left: 0, top: 0 });
  const place = () => {
    const r = trigger.current?.getBoundingClientRect();
    if (r)
      setPosition({
        left: Math.max(8, Math.min(r.right - 260, innerWidth - 268)),
        top: Math.max(
          8,
          r.bottom + 240 > innerHeight ? r.top - 240 : r.bottom + 6,
        ),
      });
  };
  useEffect(() => {
    const panel = menu.current,
      toggle = (event: Event) => {
        const open = (event as ToggleEvent).newState === 'open';
        setOpen(open);
        if (open) {
          place();
          panel?.querySelector<HTMLInputElement>('input')?.focus();
        }
      };
    panel?.addEventListener('toggle', toggle);
    window.addEventListener('resize', place);
    return () => {
      panel?.removeEventListener('toggle', toggle);
      window.removeEventListener('resize', place);
    };
  }, []);
  const selected = canvases.filter(
    (c) => value.mode === 'all' || value.canvasIds.includes(c.id),
  );
  const label =
    value.mode === 'all'
      ? '전체 캔버스'
      : selected.length === 1
        ? selected[0].name
        : selected.length
          ? `${selected.length}개 캔버스`
          : '표시 안 함';
  return (
    <>
      <button
        ref={trigger}
        className="canvas-visibility-picker"
        popoverTarget={id}
        aria-label="보드를 표시할 캔버스 선택"
        aria-expanded={open}
        aria-controls={id}
        onClick={place}
      >
        {label}
        <ChevronDown size={14} />
      </button>
      {createPortal(
        <div
          ref={menu}
          id={id}
          popover="auto"
          className="canvas-visibility-menu"
          style={position}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
              e.preventDefault();
              menu.current?.hidePopover();
              trigger.current?.focus();
            }
          }}
        >
          <div role="group" aria-label="보드를 표시할 캔버스">
            <label>
              <input
                type="checkbox"
                aria-label="전체 캔버스에 칸반 표시"
                checked={value.mode === 'all'}
                onChange={(e) =>
                  change({
                    ...value,
                    mode: e.target.checked ? 'all' : 'selected',
                    canvasIds: e.target.checked
                      ? canvases.map((c) => c.id)
                      : [],
                  })
                }
              />
              전체 캔버스
            </label>
            <small>전체를 선택하면 새 캔버스에도 표시합니다.</small>
            {canvases.map((c) => (
              <label key={c.id}>
                <input
                  type="checkbox"
                  aria-label={`${c.name}에 칸반 표시`}
                  checked={
                    value.mode === 'all' || value.canvasIds.includes(c.id)
                  }
                  onChange={(e) => {
                    const ids =
                      value.mode === 'all'
                        ? canvases.map((c) => c.id)
                        : value.canvasIds;
                    change({
                      ...value,
                      mode: 'selected',
                      canvasIds: e.target.checked
                        ? [...new Set([...ids, c.id])]
                        : ids.filter((id) => id !== c.id),
                    });
                  }}
                />
                {c.name}
              </label>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
