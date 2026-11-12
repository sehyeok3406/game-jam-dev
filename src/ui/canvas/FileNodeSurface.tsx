import {
  memo,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { NodeResizeControl, useNodeId, useStoreApi } from '@xyflow/react';
import { FileText, Gamepad2 } from 'lucide-react';
import {
  MIN_COMPACT_HEIGHT,
  MIN_COMPACT_WIDTH,
  readableOn,
  titleHeightFor,
  type CompactSize,
  type FileNodeStyle,
} from '../../core/canvas/file-node-style';

export type FileNodeDisplay = {
  style: FileNodeStyle;
  size: CompactSize;
};

function opensFileNode(event: MouseEvent<HTMLElement>) {
  return (
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.currentTarget.closest(
      '.app-shell--material-picker, .app-shell:not(.app-shell--tool-select)',
    )
  );
}

export function useSelectedFileNodeClick() {
  const id = useNodeId();
  const flow = useStoreApi();
  const pointer = useRef<AbortController | null>(null);
  const released = useRef(false);
  useEffect(() => () => pointer.current?.abort(), []);

  return {
    onPointerDownCapture(event: PointerEvent<HTMLElement>) {
      pointer.current?.abort();
      released.current = false;
      if (!id || event.button !== 0 || !opensFileNode(event)) return;
      const { nodeLookup, nodes } = flow.getState();
      // React Flow can select on mousedown. Capture the selection before it.
      if (
        !nodeLookup.get(id)?.selected ||
        nodes.some((node) => node.selected && node.id !== id)
      )
        return;

      const { pointerId, clientX, clientY, currentTarget, pointerType } = event;
      const gesture = new AbortController();
      pointer.current = gesture;
      const options = { capture: true, signal: gesture.signal };
      const moved = (next: globalThis.PointerEvent) =>
        Math.hypot(next.clientX - clientX, next.clientY - clientY) >
        (pointerType === 'touch' ? 4 : 1);
      window.addEventListener(
        'pointermove',
        (next) => {
          if (next.pointerId === pointerId && moved(next)) gesture.abort();
        },
        options,
      );
      window.addEventListener(
        'pointerup',
        (next) => {
          if (next.pointerId !== pointerId) return;
          released.current =
            !moved(next) &&
            next.target instanceof Node &&
            currentTarget.contains(next.target);
          gesture.abort();
        },
        options,
      );
      window.addEventListener(
        'pointercancel',
        (next) => {
          if (next.pointerId === pointerId) gesture.abort();
        },
        options,
      );
      window.addEventListener('blur', () => gesture.abort(), options);
    },
    canOpen(event: MouseEvent<HTMLElement>) {
      // Keyboard activation (including assistive technology) opens directly.
      const activate = event.detail === 0 || released.current;
      released.current = false;
      pointer.current?.abort();
      return activate && opensFileNode(event);
    },
  };
}

export function fileNodeVariables(
  style: FileNodeStyle,
  kind: 'md' | 'html',
  height: number,
): CSSProperties {
  const title = kind === 'md' ? style.markdownTitle : style.htmlTitle;
  const body = kind === 'md' ? style.markdownBody : '';
  const titleSize =
    kind === 'md' ? style.markdownTitleSize : style.htmlTitleSize;
  const bodySize = kind === 'md' ? style.markdownBodySize : undefined;
  return {
    '--node-radius': `${style.radius}px`,
    '--node-title-height': `${titleHeightFor(height, style.titleHeight)}px`,
    ...(titleSize
      ? {
          '--node-title-font-size': `${titleSize}px`,
          '--node-title-line-height': 1.1,
        }
      : {}),
    ...(bodySize
      ? {
          '--node-body-font-size': `${bodySize}px`,
          '--node-summary-line-height': 1.46,
        }
      : {}),
    ...(title
      ? { '--node-title-bg': title, '--node-title-fg': readableOn(title) }
      : {}),
    ...(body
      ? { '--node-body-bg': body, '--node-body-fg': readableOn(body) }
      : {}),
  } as CSSProperties;
}

export function excerptForNode(body: string, title: string) {
  const parts = body.trim().split(/\r?\n/);
  if (
    parts[0]?.replace(/^#\s+/, '').trim() === title.trim() &&
    /^#\s/.test(parts[0])
  )
    parts.shift();
  const paragraph =
    parts
      .join('\n')
      .trim()
      .split(/\r?\n\s*\r?\n/, 1)[0] ?? '';
  return paragraph
    .replace(/!?\[([^\]]*)\]\([^\n]*?\)/g, '$1')
    .replace(/^\s*(?:#{1,6}|[-*>]|\d+\.)\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const FileNodeSurface = memo(function FileNodeSurface({
  kind,
  title,
  body,
  display,
  selected,
  locked,
  hidden,
  activation,
  onOpen,
  onResize,
}: {
  kind: 'md' | 'html';
  title: string;
  body?: string;
  display: FileNodeDisplay;
  selected?: boolean;
  locked?: boolean;
  hidden?: boolean;
  activation?: ReturnType<typeof useSelectedFileNodeClick>;
  onOpen?: () => void;
  onResize?: (width: number, height: number) => void;
}) {
  const excerpt = useMemo(
    () => (body ? excerptForNode(body, title) : ''),
    [body, title],
  );
  const Icon = kind === 'md' ? FileText : Gamepad2;
  const inner = (
    <>
      <span className="file-node-title">
        <Icon size={15} aria-hidden="true" />
        <strong>{title}</strong>
        <small>{kind === 'md' ? 'MD' : 'HTML'}</small>
      </span>
      {kind === 'md' && (
        <span className="file-node-summary">
          <span>{excerpt}</span>
        </span>
      )}
    </>
  );
  const style = fileNodeVariables(display.style, kind, display.size.height);
  const className = `file-node-surface file-node-surface--${kind} file-node-drag`;
  return (
    <>
      {onOpen ? (
        <button
          type="button"
          className={className}
          style={style}
          inert={hidden || undefined}
          aria-label={`${title} 펼치기`}
          onPointerDownCapture={activation?.onPointerDownCapture}
          onKeyDown={(event) => {
            if ((event.key !== 'Enter' && event.key !== ' ') || event.repeat)
              return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.click();
          }}
          onClick={(event) => {
            if (activation ? activation.canOpen(event) : opensFileNode(event))
              onOpen();
          }}
        >
          {inner}
        </button>
      ) : (
        <div className={className} style={style}>
          {inner}
        </div>
      )}
      {selected && !locked && onResize && (
        <NodeResizeControl
          position="bottom-right"
          className="window-resize-handle nodrag"
          minWidth={MIN_COMPACT_WIDTH}
          minHeight={MIN_COMPACT_HEIGHT}
          maxWidth={1200}
          maxHeight={600}
          onResizeEnd={(_event, { width, height }) => onResize(width, height)}
        />
      )}
    </>
  );
});
