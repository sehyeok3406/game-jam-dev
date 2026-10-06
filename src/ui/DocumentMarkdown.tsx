import { createContext, useContext, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

const TaskContext = createContext<{ offset?: number; label: string }>({
  label: '항목',
});

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
  image: Components['img'];
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={{
        img: image,
        li: ({ node, children, ...props }) => {
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
        },
        input: ({ type, checked }) =>
          type === 'checkbox' ? (
            <TaskInput
              checked={checked}
              disabled={disabled}
              onToggle={onToggle}
            />
          ) : null,
      }}
    >
      {body}
    </ReactMarkdown>
  );
}
