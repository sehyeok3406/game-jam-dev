import { memo, useMemo, type CSSProperties, type MouseEvent } from 'react';
import { NodeResizeControl } from '@xyflow/react';
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

export function opensFileNode(event: MouseEvent<HTMLElement>) {
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

export function fileNodeVariables(
  style: FileNodeStyle,
  kind: 'md' | 'html',
  height: number,
): CSSProperties {
  const title = kind === 'md' ? style.markdownTitle : style.htmlTitle;
  const body = kind === 'md' ? style.markdownBody : '';
  return {
    '--node-radius': `${style.radius}px`,
    '--node-title-height': `${titleHeightFor(height, style.titleHeight)}px`,
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
          onKeyDown={(event) => {
            if ((event.key !== 'Enter' && event.key !== ' ') || event.repeat)
              return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.click();
          }}
          onClick={(event) => {
            if (opensFileNode(event)) onOpen();
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
