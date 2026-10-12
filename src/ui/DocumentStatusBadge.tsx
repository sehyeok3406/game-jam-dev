import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, LockKeyhole } from 'lucide-react';
import {
  workflowId,
  statusForeground,
  type DocumentStatuses,
} from '../document-statuses';
export function DocumentStatusBadge({
  document: doc,
  statuses,
  disabled,
  reason,
  change,
  manage,
}: {
  document: { workflowStatusId?: string };
  statuses: DocumentStatuses;
  disabled: boolean;
  reason?: string;
  change: (id: string) => void;
  manage: () => void;
}) {
  const id = workflowId(doc),
    status = statuses.statuses.find((s) => s.id === id),
    color = status?.badgeColor ?? '#6B7280';
  const menuId = useId(),
    trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false),
    [position, setPosition] = useState({ left: 0, top: 0 });
  const place = () => {
    const r = trigger.current?.getBoundingClientRect();
    if (r)
      setPosition({
        left: Math.max(8, Math.min(r.right - 240, window.innerWidth - 248)),
        top: Math.max(
          8,
          r.bottom + 252 > window.innerHeight
            ? r.top - Math.min(260, window.innerHeight - 24)
            : r.bottom + 6,
        ),
      });
  };
  useEffect(() => {
    const panel = menu.current;
    const toggle = (e: Event) => {
      const open = (e as ToggleEvent).newState === 'open';
      setExpanded(open);
      if (open) {
        place();
        panel
          ?.querySelector<HTMLButtonElement>(
            '[aria-selected=true], [role=option]',
          )
          ?.focus();
      }
    };
    panel?.addEventListener('toggle', toggle);
    return () => panel?.removeEventListener('toggle', toggle);
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const reposition = () => place();
    window.addEventListener('resize', reposition);
    return () => window.removeEventListener('resize', reposition);
  }, [expanded]);
  const close = () => {
    menu.current?.hidePopover();
    trigger.current?.focus();
  };
  return (
    <>
      <button
        type="button"
        ref={trigger}
        className="workflow-badge nodrag nowheel"
        aria-label={`문서 상태: ${status?.name ?? '알 수 없는 상태'}`}
        title={
          disabled
            ? (reason ?? '현재 상태를 변경할 수 없습니다.')
            : status?.name
        }
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls={menuId}
        aria-disabled={disabled || undefined}
        popoverTarget={menuId}
        style={
          {
            '--workflow-color': color,
            color: statusForeground(color),
            backgroundColor: color,
          } as CSSProperties
        }
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          place();
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <span>{status?.name ?? '알 수 없는 상태'}</span>
        {disabled ? <LockKeyhole size={11} /> : <ChevronDown size={12} />}
      </button>
      {createPortal(
        <div
          ref={menu}
          id={menuId}
          popover="auto"
          className="workflow-status-menu nodrag nowheel"
          style={position}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
              e.preventDefault();
              close();
            }
            if (
              e.key === 'ArrowDown' ||
              e.key === 'ArrowUp' ||
              e.key === 'Home' ||
              e.key === 'End'
            ) {
              e.preventDefault();
              const buttons = [
                ...(menu.current?.querySelectorAll<HTMLButtonElement>(
                  'button:not(:disabled)',
                ) ?? []),
              ];
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? buttons.length - 1
                    : (index +
                        (e.key === 'ArrowDown' ? 1 : -1) +
                        buttons.length) %
                      buttons.length;
              buttons[next]?.focus();
            }
          }}
        >
          {disabled && (
            <p className="workflow-menu-reason" role="status">
              {reason ?? '현재 상태를 변경할 수 없습니다.'}
            </p>
          )}
          <div role="listbox" aria-label="문서 진행 상태">
            {statuses.statuses.map((s) => (
              <button
                type="button"
                role="option"
                key={s.id}
                aria-selected={s.id === id}
                disabled={disabled}
                onClick={() => {
                  close();
                  change(s.id);
                }}
              >
                <span
                  className="workflow-option-dot"
                  style={{ backgroundColor: s.badgeColor }}
                />
                <span>{s.name}</span>
                {s.id === id && <Check size={14} />}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="workflow-manage-option"
            disabled={disabled}
            onClick={() => {
              close();
              manage();
            }}
          >
            상태 관리…
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
