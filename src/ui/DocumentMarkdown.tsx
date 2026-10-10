import { createContext, useContext, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

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
  body,
  disabled,
  onToggle,
  image,
}: {
  body: string;
  disabled: boolean;
  onToggle: (offset: number, checked: boolean) => void;
  image: RenderSettings['image'];
}) {
  return (
    <RenderContext.Provider value={{ disabled, onToggle, image }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={components}
      >
        {body}
      </ReactMarkdown>
    </RenderContext.Provider>
  );
}
