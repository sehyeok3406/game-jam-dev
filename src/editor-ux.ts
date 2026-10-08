/** Tools use screen coordinates, independent of the canvas transform. */
export function editorToolPosition(
  anchor: { left: number; top: number; bottom: number },
  viewport: { width: number; height: number },
  width: number,
  height: number,
) {
  return {
    left: Math.max(12, Math.min(anchor.left, viewport.width - width - 12)),
    top: Math.max(
      12,
      Math.min(
        anchor.top >= height + 20 ? anchor.top - height - 8 : anchor.bottom + 8,
        viewport.height - height - 12,
      ),
    ),
  };
}
export const EDITOR_COMMANDS = [
  { id: 'paragraph', label: '본문', keywords: 'text paragraph 본문' },
  { id: 'h1', label: '제목 1', keywords: 'heading 제목 h1' },
  { id: 'h2', label: '제목 2', keywords: 'heading 제목 h2' },
  { id: 'h3', label: '제목 3', keywords: 'heading 제목 h3' },
  { id: 'bullet', label: '글머리 목록', keywords: 'bullet list 목록 리스트' },
  { id: 'ordered', label: '번호 목록', keywords: 'number list 순서 번호' },
  { id: 'task', label: '체크리스트', keywords: 'check task 할일 체크' },
  { id: 'quote', label: '인용', keywords: 'quote 인용' },
  { id: 'rule', label: '구분선', keywords: 'divider line 구분선' },
  { id: 'table', label: '표', keywords: 'table 표' },
  { id: 'code', label: '코드 블록', keywords: 'code 코드' },
] as const;
export type EditorCommandId = (typeof EDITOR_COMMANDS)[number]['id'];
export function editorCommands(query: string) {
  return EDITOR_COMMANDS.filter((command) =>
    `${command.label} ${command.keywords}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
}
/** Never turn code, ordinary slashes or Korean IME composition into commands. */
export function slashQuery(
  text: string,
  paragraph: boolean,
  composing: boolean,
) {
  return paragraph && !composing && /^\/[^\s/]{0,24}$/.test(text)
    ? text.slice(1)
    : null;
}

export type EditorDraft = { title: string; body: string };
/** The storage adapters trim body edges and use a fallback for empty titles. */
export function editorDraftMatches(left: EditorDraft, right: EditorDraft) {
  return (
    (left.title.trim() || '제목 없음') ===
      (right.title.trim() || '제목 없음') &&
    left.body.trim() === right.body.trim()
  );
}
/** A finishing write must include text entered while the previous write was pending. */
export async function drainEditorDraft(
  read: () => EditorDraft,
  saved: () => EditorDraft,
  write: (draft: EditorDraft) => Promise<void>,
  finish: boolean,
  beforeRead?: () => Promise<void>,
) {
  do {
    await beforeRead?.();
    const current = { ...read() },
      previous = saved();
    if (current.title === previous.title && current.body === previous.body)
      return;
    await write(current);
  } while (finish);
}

export type SourceSnapshot = { value: string; start: number; end: number };
/** Controlled textarea edits (including formatting) need their own undo history. */
export class SourceHistory {
  private past: SourceSnapshot[] = [];
  private future: SourceSnapshot[] = [];
  private lastTyping = 0;
  reset() {
    this.past = [];
    this.future = [];
    this.lastTyping = 0;
  }
  record(before: SourceSnapshot, typing = false, now = Date.now()) {
    if (
      !typing ||
      !this.lastTyping ||
      now - this.lastTyping > 500 ||
      this.future.length
    )
      this.past.push({ ...before });
    this.past = this.past.slice(-100);
    this.future = [];
    this.lastTyping = typing ? now : 0;
  }
  move(direction: 'undo' | 'redo', current: SourceSnapshot) {
    const from = direction === 'undo' ? this.past : this.future;
    const to = direction === 'undo' ? this.future : this.past;
    const next = from.pop();
    if (!next) return null;
    to.push({ ...current });
    this.lastTyping = 0;
    return next;
  }
}
