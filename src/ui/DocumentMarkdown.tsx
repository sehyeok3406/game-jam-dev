import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { remarkLocationAnchors } from './locations/remark-location-anchors.ts';
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { remarkLineBreaks } from './markdown-line-breaks';
import { remarkDocumentTitle } from './documents/markdown-title';
import {
  AUTO_LINK_TITLE,
  parseDocumentLink,
  linkStatusText,
} from '../document-links';
import { useDocumentLinks } from './DocumentLinksContext';
import { parseLocationLink } from '../core/projects/location-links.ts';

const isSharedLocationLink = (url: string) => {
  try {
    parseLocationLink(url);
    return true;
  } catch {
    return false;
  }
};

const MarkdownLink: NonNullable<Components['a']> = ({
  href,
  title,
  children,
}) => {
  const links = useDocumentLinks();
  if (href === '') return <span>{children}</span>;
  if (!href?.startsWith('gamejam:'))
    return (
      <a href={href} title={title}>
        {children}
      </a>
    );
  if (isSharedLocationLink(href))
    return (
      <a
        href={href}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          links.open(href);
        }}
      >
        {children}
      </a>
    );
  const resolved = links.resolve(href);
  return (
    <a
      href={href}
      className={`document-link${resolved.status === 'found' ? '' : ' document-link--missing'}`}
      title={
        resolved.status === 'found'
          ? `${resolved.document.title} · ${links.canvasName(resolved.document.canvasId)} · ${resolved.document.relativePath}`
          : linkStatusText(resolved)
      }
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        links.open(href);
      }}
    >
      {title === AUTO_LINK_TITLE && resolved.status === 'found'
        ? resolved.document.title
        : children}
    </a>
  );
};

const TaskContext = createContext<{ offset?: number; label: string }>({
  label: '항목',
});
type RenderSettings = {
  disabled: boolean;
  onToggle: (offset: number, checked: boolean) => void;
  image: (props: { src?: string | Blob; alt?: string }) => ReactNode;
};
const RenderContext = createContext<RenderSettings | null>(null);
function MarkdownImage(props: { src?: string | Blob; alt?: string }) {
  return useContext(RenderContext)?.image(props);
}
const MarkdownListItem: NonNullable<Components['li']> = ({
  node,
  children,
  ...props
}) => {
  const text = (item: unknown): string => {
    const child = item as { value?: string; children?: unknown[] };
    return child.value ?? child.children?.map(text).join('') ?? '';
  };
  return (
    <TaskContext.Provider
      value={{
        offset: node?.position?.start.offset,
        label: text(node).trim() || '빈 항목',
      }}
    >
      <li {...props}>{children as ReactNode}</li>
    </TaskContext.Provider>
  );
};
function MarkdownInput({
  type,
  checked,
}: {
  type?: string;
  checked?: boolean;
}) {
  const settings = useContext(RenderContext);
  return type === 'checkbox' && settings ? (
    <TaskInput
      checked={checked}
      disabled={settings.disabled}
      onToggle={settings.onToggle}
    />
  ) : null;
}
const components: Components = {
  a: MarkdownLink,
  img: MarkdownImage,
  li: MarkdownListItem,
  input: MarkdownInput,
};

function TaskInput({
  checked,
  disabled,
  onToggle,
}: {
  checked?: boolean;
  disabled: boolean;
  onToggle: (offset: number, checked: boolean) => void;
}) {
  const task = useContext(TaskContext);
  return (
    <input
      type="checkbox"
      checked={!!checked}
      aria-label={`체크리스트: ${task.label}`}
      disabled={disabled || task.offset === undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => {
        if (task.offset !== undefined)
          onToggle(task.offset, event.target.checked);
      }}
    />
  );
}

export function DocumentMarkdown({
  copyBlock,
  body,
  title,
  disabled,
  onToggle,
  image,
}: {
  copyBlock?: (id: string) => void;
  body: string;
  title?: string;
  disabled: boolean;
  onToggle: (offset: number, checked: boolean) => void;
  image: RenderSettings['image'];
}) {
  const [blockMenu, setBlockMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  return (
    <RenderContext.Provider value={{ disabled, onToggle, image }}>
      <div
        onContextMenu={(event) => {
          if (!copyBlock) return;
          const paragraph = (event.target as Element).closest(
            'p,h1,h2,h3,h4,h5,h6,td,li',
          );
          const anchors = paragraph?.querySelectorAll<HTMLElement>(
            '[data-location-block]',
          );
          if (anchors?.length !== 1) return;
          event.preventDefault();
          event.stopPropagation();
          setBlockMenu({
            id: anchors[0].dataset.locationBlock!,
            x: event.clientX,
            y: event.clientY,
          });
        }}
      >
        <ReactMarkdown
          urlTransform={(url) =>
            parseDocumentLink(url) || isSharedLocationLink(url)
              ? url
              : defaultUrlTransform(url)
          }
          remarkPlugins={[
            remarkGfm,
            remarkBreaks,
            remarkLineBreaks,
            remarkLocationAnchors,
            [remarkDocumentTitle, { title }],
          ]}
          components={components}
        >
          {body}
        </ReactMarkdown>
      </div>
      {blockMenu &&
        copyBlock &&
        createPortal(
          <button
            type="button"
            className="location-block-menu floating-surface"
            autoFocus
            onBlur={() => setBlockMenu(null)}
            style={{
              position: 'fixed',
              left: Math.min(blockMenu.x, window.innerWidth - 200),
              top: Math.min(blockMenu.y, window.innerHeight - 50),
              zIndex: 150,
              padding: 12,
            }}
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              copyBlock(blockMenu.id);
              setBlockMenu(null);
            }}
          >
            문단 위치 링크 복사
          </button>,
          document.body,
        )}
    </RenderContext.Provider>
  );
}
