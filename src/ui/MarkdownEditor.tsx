import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { previewState } from './debug/uiDebugPreviewState';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { getMarkRange } from '@tiptap/core';
import {
  documentLinkHref,
  documentLinkMarkdown,
  extractDocumentLinks,
  parseDocumentLink,
  searchLinkDocuments,
  sourceLinkQuery,
  type LinkDocument,
} from '../document-links';
import { refreshDocumentLinkViews } from '../document-link-node';
import { useDocumentLinks } from './DocumentLinksContext';
import { DocumentLinkPicker } from './DocumentLinkPicker';
import {
  Bold,
  Italic,
  List,
  Plus,
  MoreHorizontal,
  ChevronDown,
  Maximize2,
  Minimize2,
  X,
  HelpCircle,
  Code2,
  Link2,
} from 'lucide-react';
import { markdownExtensions } from '../markdown-extensions';
import { canEditMarkdownVisually, MARKDOWN_HELP } from '../markdown-editing';
import { markdownEdit } from '../canvas-ux';
import {
  editorCommands,
  editorToolPosition,
  slashQuery,
  type EditorCommandId,
  SourceHistory,
} from '../editor-ux';

type Props = {
  value: string;
  onChange: (value: string) => void;
  locked: boolean;
  owner: string;
  title: string;
  onTitle: (title: string) => void;
  status: string;
  onFinish: () => void;
  onSave: () => void;
  onCompositionChange?: (value: boolean) => void;
  initialFocus?: { title: boolean; point?: { x: number; y: number } };
  currentCanvas?: string;
};
export function MarkdownEditor({
  value,
  onChange,
  locked,
  owner,
  title,
  onTitle,
  status,
  onFinish,
  onSave,
  onCompositionChange,
  initialFocus,
  currentCanvas,
}: Props) {
  const links = useDocumentLinks();
  const linksRef = useRef(links);
  linksRef.current = links;
  type LinkRange = {
    mode: 'source' | 'visual';
    from: number;
    to: number;
    query: string;
    label: string;
    automatic: boolean;
    href?: string;
    trigger: boolean;
    body?: string;
  };
  const [linkRange, setLinkRange] = useState<LinkRange | null>(null);
  const [linkIndex, setLinkIndex] = useState(0);
  const linkRangeRef = useRef(linkRange);
  linkRangeRef.current = linkRange;
  const dismissedLink = useRef<number | null>(null);
  const [source, setSource] = useState(previewState('editor') === 'source'),
    [warning, setWarning] = useState(
      previewState('editor') === 'warning'
        ? '샘플 경고: 원문에서 내용을 확인해주세요.'
        : '',
    );
  const [menu, setMenu] = useState<string | null>(
      ['text', 'insert', 'more'].includes(previewState('editor') ?? '')
        ? previewState('editor')!
        : null,
    ),
    [focused, setFocused] = useState(previewState('editor') === 'focus');
  const [slash, setSlash] = useState<{
    query: string;
    from: number;
    to: number;
  } | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [tableRows, setTableRows] = useState(3),
    [tableCols, setTableCols] = useState(2);
  const [position, setPosition] = useState({ left: 12, top: 100 });
  const areaRef = useRef<HTMLTextAreaElement>(null),
    anchorRef = useRef<HTMLDivElement>(null),
    toolsRef = useRef<HTMLDivElement>(null),
    dialogRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onChange, value, locked });
  callbacks.current = { onChange, value, locked };
  const lastEmitted = useRef(value),
    composing = useRef(false),
    dismissedSlash = useRef<number | null>(null);
  const slashRef = useRef(slash);
  slashRef.current = slash;
  const keyHandler = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const sourceHistory = useRef(new SourceHistory());
  const extensions = useMemo(
    () =>
      markdownExtensions({
        resolve: (href) => linksRef.current.resolve(href),
        open: (href) => linksRef.current.open(href),
      }),
    [],
  );
  const editorProps = useMemo(
    () => ({
      attributes: {
        class: 'markdown-body',
        role: 'textbox',
        'aria-label': '문서 내용',
        'aria-multiline': 'true',
      },
      handleKeyDown: (
        _view: import('@tiptap/pm/view').EditorView,
        event: KeyboardEvent,
      ) => keyHandler.current(event),
      handleClick: (
        _view: import('@tiptap/pm/view').EditorView,
        _pos: number,
        event: MouseEvent,
      ) => {
        const anchor = (event.target as Element)?.closest('a[href]');
        const href = anchor?.getAttribute('href') ?? '';
        if (!parseDocumentLink(href)) return false;
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
          event.stopPropagation();
          linksRef.current.open(href);
          return true;
        }
        return false;
      },
    }),
    [],
  );
  const editor = useEditor({
    extensions,
    shouldRerenderOnTransaction: false,
    content: value,
    contentType: 'markdown',
    editable: !locked,
    editorProps,
    onUpdate: ({ editor }) => {
      if (callbacks.current.locked) return;
      const next = editor.getMarkdown();
      lastEmitted.current = next;
      callbacks.current.onChange(next);
    },
  });
  useEffect(() => {
    if (editor) refreshDocumentLinkViews(editor);
  }, [editor, links]);
  const cancelLink = () => {
    if (linkRangeRef.current?.trigger)
      dismissedLink.current = linkRangeRef.current.from;
    setLinkRange(null);
    requestAnimationFrame(() =>
      source ? areaRef.current?.focus() : editor?.commands.focus(),
    );
  };
  const updateLinkTrigger = (body?: string, caret?: number) => {
    if (
      locked ||
      composing.current ||
      editor?.view.composing ||
      (linkRangeRef.current && !linkRangeRef.current.trigger)
    )
      return;
    let range: { query: string; from: number; to: number } | null = null;
    if (source) {
      const area = areaRef.current;
      if (area && area.selectionStart === area.selectionEnd)
        range = sourceLinkQuery(
          body ?? callbacks.current.value,
          caret ?? area.selectionStart,
        );
    } else if (editor) {
      const selection = editor.state.selection;
      if (
        selection.empty &&
        !editor.isActive('code') &&
        !editor.isActive('codeBlock') &&
        !editor.isActive('link')
      ) {
        const text = selection.$from.parent.textBetween(
          0,
          selection.$from.parentOffset,
          '',
          '\ufffc',
        );
        const match = /(?<![\\[])\[\[([^\]\r\n[]{0,80})$/.exec(text);
        if (match)
          range = {
            query: match[1],
            from: selection.from - match[0].length,
            to: selection.from,
          };
      }
    }
    if (!range || dismissedLink.current === range.from) {
      if (linkRangeRef.current?.trigger) setLinkRange(null);
      return;
    }
    setSlash(null);
    setMenu(null);
    setLinkIndex(0);
    setLinkRange({
      ...range,
      mode: source ? 'source' : 'visual',
      label: '',
      automatic: true,
      trigger: true,
      body: source ? (body ?? callbacks.current.value) : undefined,
    });
  };
  const openLinkPicker = () => {
    if (locked || composing.current || editor?.view.composing) return;
    setSlash(null);
    setMenu(null);
    setLinkIndex(0);
    if (source) {
      const area = areaRef.current;
      if (!area) return;
      const existing = extractDocumentLinks(value).find(
        (link) =>
          link.from <= area.selectionStart && link.to >= area.selectionEnd,
      );
      const label =
        existing?.label ?? value.slice(area.selectionStart, area.selectionEnd);
      if (/\r|\n/.test(label)) {
        setWarning('링크로 연결할 문구는 한 줄로 선택해주세요.');
        return;
      }
      setLinkRange({
        mode: 'source',
        from: existing?.from ?? area.selectionStart,
        to: existing?.to ?? area.selectionEnd,
        href: existing?.href,
        label,
        automatic: existing?.automatic ?? !label,
        query: '',
        trigger: false,
        body: value,
      });
    } else if (editor) {
      const selection = editor.state.selection;
      if (editor.isActive('code') || editor.isActive('codeBlock')) return;
      const selectedNode =
        'node' in selection
          ? (selection.node as import('@tiptap/pm/model').Node)
          : null;
      const after = selection.$from.nodeAfter,
        before = selection.$from.nodeBefore;
      const node =
        selectedNode?.type.name === 'documentLink'
          ? selectedNode
          : after?.type.name === 'documentLink' &&
              (selection.empty ||
                selection.to === selection.from + after.nodeSize)
            ? after
            : selection.empty && before?.type.name === 'documentLink'
              ? before
              : null;
      const mark = getMarkRange(selection.$from, editor.schema.marks.link);
      const from =
          node && node === before
            ? selection.from - node.nodeSize
            : (mark?.from ?? selection.from),
        to = node ? from + node.nodeSize : (mark?.to ?? selection.to);
      const href =
        node?.type.name === 'documentLink'
          ? node.attrs.href
          : editor.getAttributes('link').href;
      const resolved = href ? linksRef.current.resolve(href) : null;
      const label =
        node?.type.name === 'documentLink'
          ? resolved?.status === 'found'
            ? resolved.document.title
            : node.attrs.label
          : editor.state.doc.textBetween(from, to, '\n');
      if (/\r|\n/.test(label)) {
        setWarning('링크로 연결할 문구는 한 줄로 선택해주세요.');
        return;
      }
      setLinkRange({
        mode: 'visual',
        from,
        to,
        label,
        automatic: node?.type.name === 'documentLink' || !label,
        href: parseDocumentLink(href ?? '') ? href : undefined,
        query: '',
        trigger: false,
      });
    }
  };
  const applyLink = (doc?: LinkDocument) => {
    const range = linkRangeRef.current;
    if (!range || locked || composing.current || editor?.view.composing) return;
    const href = doc ? documentLinkHref(doc) : range.href;
    if (doc && (!href || linksRef.current.resolve(href).status !== 'found')) {
      setWarning('연결 대상이 변경되었습니다. 다시 검색해주세요.');
      return;
    }
    const label =
      doc && (range.automatic || !range.label) ? doc.title : range.label;
    if (!label.trim()) {
      setWarning('링크 표시 문구를 입력해주세요.');
      return;
    }
    if (range.mode === 'source') {
      const body = callbacks.current.value;
      if (body !== range.body) {
        setWarning('본문이 변경되었습니다. 링크를 다시 선택해주세요.');
        cancelLink();
        return;
      }
      const area = areaRef.current!;
      const replacement = doc
        ? documentLinkMarkdown(href!, label, range.automatic)
        : label;
      sourceHistory.current.record({
        value: body,
        start: range.from,
        end: range.to,
      });
      const next =
        body.slice(0, range.from) + replacement + body.slice(range.to);
      lastEmitted.current = next;
      onChange(next);
      requestAnimationFrame(() => {
        area.focus();
        area.setSelectionRange(
          range.from + replacement.length,
          range.from + replacement.length,
        );
      });
    } else if (editor) {
      // Clear menu first: our own transaction must not remap its replacement range.
      linkRangeRef.current = null;
      const plainRange =
        editor.state.doc.textBetween(range.from, range.to, '\n') === label &&
        !range.trigger &&
        range.from !== range.to;
      if (!doc && plainRange)
        editor
          .chain()
          .focus()
          .setTextSelection({ from: range.from, to: range.to })
          .unsetLink()
          .run();
      else if (!doc)
        editor
          .chain()
          .focus()
          .insertContentAt(
            { from: range.from, to: range.to },
            { type: 'text', text: label },
          )
          .run();
      else if (range.automatic)
        editor
          .chain()
          .focus()
          .insertContentAt(
            { from: range.from, to: range.to },
            { type: 'documentLink', attrs: { href, label } },
          )
          .run();
      else if (plainRange)
        editor
          .chain()
          .focus()
          .setTextSelection({ from: range.from, to: range.to })
          .setLink({ href: href!, title: null })
          .run();
      else
        editor
          .chain()
          .focus()
          .insertContentAt(
            { from: range.from, to: range.to },
            {
              type: 'text',
              text: label,
              marks: [{ type: 'link', attrs: { href, title: null } }],
            },
          )
          .run();
    }
    setLinkRange(null);
    setWarning('');
  };
  const handleLinkKey = (event: KeyboardEvent | React.KeyboardEvent) => {
    if (
      composing.current ||
      ('isComposing' in event
        ? event.isComposing
        : event.nativeEvent.isComposing) ||
      locked
    )
      return false;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      event.stopPropagation();
      openLinkPicker();
      return true;
    }
    const range = linkRangeRef.current;
    if (!range) return false;
    const results = searchLinkDocuments(
      linksRef.current.documents,
      range.query,
      currentCanvas,
    );
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelLink();
      return true;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      setLinkIndex((index) =>
        results.length
          ? (index + (event.key === 'ArrowDown' ? 1 : results.length - 1)) %
            results.length
          : 0,
      );
      return true;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (results[linkIndex]) applyLink(results[linkIndex]);
      return true;
    }
    return false;
  };
  useEffect(() => {
    if (!editor) return;
    const update = () => updateLinkTrigger();
    const map = ({
      transaction,
    }: {
      transaction: import('@tiptap/pm/state').Transaction;
    }) => {
      const range = linkRangeRef.current;
      if (
        !range ||
        range.mode !== 'visual' ||
        !transaction.docChanged ||
        range.trigger
      )
        return;
      const from = transaction.mapping.mapResult(range.from, 1),
        to = transaction.mapping.mapResult(range.to, -1);
      if (from.deleted || to.deleted) {
        setLinkRange(null);
        return;
      }
      setLinkRange({ ...range, from: from.pos, to: to.pos });
    };
    editor.on('update', update);
    editor.on('selectionUpdate', update);
    editor.on('transaction', map);
    return () => {
      editor.off('update', update);
      editor.off('selectionUpdate', update);
      editor.off('transaction', map);
    };
  }, [editor, source, locked]);
  useEffect(() => {
    setLinkRange(null);
  }, [source, locked, owner]);
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      heading: editor?.getAttributes('heading').level ?? 0,
      bold: editor?.isActive('bold'),
      italic: editor?.isActive('italic'),
      strike: editor?.isActive('strike'),
      bullet: editor?.isActive('bulletList'),
      ordered: editor?.isActive('orderedList'),
      task: editor?.isActive('taskList'),
      quote: editor?.isActive('blockquote'),
      code: editor?.isActive('codeBlock'),
      table: editor?.isActive('table'),
    }),
  });
  // Loading/switching modes is never an edit. Preserve lossy syntax in source mode.
  const loadVisual = (body: string) => {
    if (!editor) return false;
    editor.commands.setContent(body, {
      contentType: 'markdown',
      emitUpdate: false,
    });
    if (!canEditMarkdownVisually(body, editor.getMarkdown())) {
      setWarning(
        '원문 보호: 이 문법은 서식 편집으로 보존할 수 없어 Markdown 원문으로 엽니다.',
      );
      setSource(true);
      return false;
    }
    setWarning(
      previewState('editor') === 'warning'
        ? '샘플 경고: 원문에서 내용을 확인해주세요.'
        : '',
    );
    return true;
  };
  const updateSlash = () => {
    if (!editor || source || callbacks.current.locked) return setSlash(null);
    const selection = editor.state.selection;
    const query = slashQuery(
      selection.$from.parent.textBetween(
        0,
        selection.$from.parentOffset,
        '',
        '\ufffc',
      ),
      selection.$from.parent.type.name === 'paragraph' && selection.empty,
      composing.current || editor.view.composing,
    );
    if (query === null || selection.$from.start() === dismissedSlash.current)
      setSlash(null);
    else {
      setSlash({ query, from: selection.$from.start(), to: selection.from });
      setSlashIndex((index) =>
        Math.min(index, Math.max(0, editorCommands(query).length - 1)),
      );
    }
  };
  useEffect(() => {
    editor?.setEditable(!locked);
    if (locked) {
      setMenu(null);
      setSlash(null);
    }
  }, [editor, locked]);
  useEffect(() => {
    if (editor && value !== lastEmitted.current) {
      lastEmitted.current = value;
      loadVisual(value);
    }
  }, [editor, value]);
  useEffect(() => {
    if (editor) loadVisual(callbacks.current.value);
  }, [editor]);
  useEffect(() => {
    if (!editor || previewState('editor') !== 'slash') return;
    editor.commands.setContent('<p>/</p>');
    editor.commands.focus('end');
    setSlash({ query: '', from: 1, to: 2 });
  }, [editor]);
  useEffect(() => {
    const state = previewState('editor');
    if (!editor || !['link-search', 'link-empty'].includes(state ?? '')) return;
    setLinkRange({
      mode: 'visual',
      from: 1,
      to: 1,
      query: state === 'link-empty' ? '존재하지 않는 문서' : '',
      label: '',
      automatic: true,
      trigger: false,
    });
  }, [editor]);
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      dismissedSlash.current = null;
      updateSlash();
    };
    editor.on('update', update);
    editor.on('selectionUpdate', updateSlash);
    return () => {
      editor.off('update', update);
      editor.off('selectionUpdate', updateSlash);
    };
  }, [editor, source]);
  useEffect(() => {
    if (!editor || initialFocus?.title) return;
    const frame = requestAnimationFrame(() => {
      if (source) areaRef.current?.focus();
      else {
        const point = initialFocus?.point;
        const hit = point
          ? editor.view.posAtCoords({ left: point.x, top: point.y })
          : null;
        editor.commands.focus(hit?.pos ?? 'start');
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [editor, source]);
  // Portal tools stay readable and avoid React Flow's transform/clipping.
  useEffect(() => {
    if (focused) return;
    let frame = 0;
    const update = () => {
      const rect = anchorRef.current
          ?.closest('.document-card')
          ?.getBoundingClientRect(),
        tools = toolsRef.current;
      if (rect && tools) {
        const next = editorToolPosition(
          rect,
          { width: window.innerWidth, height: window.innerHeight },
          tools.offsetWidth,
          tools.offsetHeight,
        );
        setPosition((old) =>
          old.left === next.left && old.top === next.top ? old : next,
        );
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [focused]);
  const restoreFocus = () =>
    requestAnimationFrame(() =>
      source ? areaRef.current?.focus() : editor?.commands.focus(),
    );
  useEffect(() => {
    if (!focused) return;
    restoreFocus();
    const dialog = dialogRef.current;
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = [
        ...(dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea,[contenteditable="true"]',
        ) ?? []),
      ].filter((item) => item.getClientRects().length > 0);
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault();
        items.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
        event.preventDefault();
        items[0]?.focus();
      }
    };
    dialog?.addEventListener('keydown', trap);
    return () => dialog?.removeEventListener('keydown', trap);
  }, [focused, source]);
  const sourceFormat = (action: Parameters<typeof markdownEdit>[3]) => {
    const area = areaRef.current;
    if (!area || locked) return;
    const edit = markdownEdit(
      value,
      area.selectionStart,
      area.selectionEnd,
      action,
    );
    sourceHistory.current.record({
      value,
      start: area.selectionStart,
      end: area.selectionEnd,
    });
    lastEmitted.current = edit.body;
    onChange(edit.body);
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(edit.start, edit.end);
    });
  };
  const runCommand = (id: EditorCommandId) => {
    if (locked || !editor) return;
    if (source) {
      const action = {
        paragraph: null,
        h1: 'heading',
        h2: 'heading',
        h3: 'heading',
        bullet: 'list',
        ordered: 'ordered',
        task: 'check',
        quote: 'quote',
        rule: 'rule',
        table: 'table',
        code: 'code',
      } as const;
      if (action[id]) sourceFormat(action[id]);
    } else {
      const chain = editor.chain().focus();
      if (id === 'paragraph') chain.setParagraph().run();
      else if (id === 'h1' || id === 'h2' || id === 'h3')
        chain.setHeading({ level: Number(id.slice(1)) as 1 | 2 | 3 }).run();
      else if (id === 'bullet') chain.toggleBulletList().run();
      else if (id === 'ordered') chain.toggleOrderedList().run();
      else if (id === 'task') chain.toggleTaskList().run();
      else if (id === 'quote') chain.toggleBlockquote().run();
      else if (id === 'rule') chain.setHorizontalRule().run();
      else if (id === 'table')
        chain
          .insertTable({
            rows: tableRows,
            cols: tableCols,
            withHeaderRow: true,
          })
          .run();
      else chain.toggleCodeBlock().run();
    }
    setMenu(null);
    setSlash(null);
  };
  const chooseSlash = (id: EditorCommandId) => {
    const range = slashRef.current;
    if (locked || !editor || !range || editor.view.composing) return;
    editor
      .chain()
      .focus()
      .deleteRange({ from: range.from, to: range.to })
      .run();
    runCommand(id);
  };
  keyHandler.current = (event) => {
    if (handleLinkKey(event)) return true;
    if (event.isComposing || composing.current || locked) return false;
    const commands = editorCommands(slashRef.current?.query ?? '');
    if (slashRef.current) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashIndex((index) =>
          commands.length
            ? (index + (event.key === 'ArrowDown' ? 1 : commands.length - 1)) %
              commands.length
            : 0,
        );
        return true;
      }
      if (event.key === 'Enter' && commands[slashIndex]) {
        event.preventDefault();
        chooseSlash(commands[slashIndex].id);
        return true;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        dismissedSlash.current = slashRef.current.from;
        setSlash(null);
        return true;
      }
    }
    return false;
  };
  const action = (
    label: string,
    child: ReactNode,
    run: () => void,
    active?: boolean,
  ) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={locked || !editor}
      onMouseDown={(event) => event.preventDefault()}
      onClick={run}
    >
      {child}
    </button>
  );
  const toggleMenu = (id: string) => {
    setSlash(null);
    setLinkRange(null);
    setMenu(menu === id ? null : id);
  };
  const menuItem = (label: string, run: () => void, active?: boolean) =>
    action(
      label,
      <>
        <span>{label}</span>
        {active && <span aria-hidden="true">✓</span>}
      </>,
      () => {
        setMenu(null);
        run();
      },
      active,
    );
  const closeFocus = () => {
    setFocused(false);
    setMenu(null);
    setLinkRange(null);
    restoreFocus();
  };
  const dismissMenus = (event: React.KeyboardEvent) => {
    if (event.isPropagationStopped()) return;
    if (linkRangeRef.current && handleLinkKey(event)) return;
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      if (menu || slash) {
        event.preventDefault();
        event.stopPropagation();
        setMenu(null);
        if (slash) dismissedSlash.current = slash.from;
        setSlash(null);
        restoreFocus();
      } else if (focused) {
        event.preventDefault();
        event.stopPropagation();
        closeFocus();
      }
    }
  };
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        !event.target.closest(`[data-editor-tools="${owner}"]`)
      ) {
        setMenu(null);
        if (linkRangeRef.current?.trigger)
          dismissedLink.current = linkRangeRef.current.from;
        setLinkRange(null);
      }
    };
    window.addEventListener('pointerdown', outside);
    return () => window.removeEventListener('pointerdown', outside);
  }, [owner]);
  const toolbar = (
    <div
      ref={toolsRef}
      className={`editor-floating-tools${focused ? ' editor-floating-tools--focused' : ''}`}
      data-editor-owner={owner}
      data-editor-tools={owner}
      style={focused ? undefined : { left: position.left, top: position.top }}
      onKeyDown={dismissMenus}
    >
      <div
        className="editor-toolbar"
        role="toolbar"
        aria-label="메모 서식"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
            return;
          const buttons = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                'button:not(:disabled)',
              ),
            ],
            index = buttons.indexOf(event.target as HTMLButtonElement);
          if (index < 0) return;
          event.preventDefault();
          buttons[
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (index +
                    (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) %
                  buttons.length
          ]?.focus();
        }}
      >
        {!source && (
          <button
            type="button"
            className="editor-text-type"
            aria-label="텍스트 종류"
            aria-expanded={menu === 'text'}
            disabled={locked}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => toggleMenu('text')}
          >
            {state?.heading ? `제목 ${state.heading}` : '본문'}
            <ChevronDown size={13} />
          </button>
        )}
        {source && (
          <span className="editor-mode-label">
            <Code2 size={14} /> 원문
          </span>
        )}
        <span className="editor-tool-divider" />
        {action(
          '굵게 (Ctrl+B)',
          <Bold size={16} />,
          () =>
            source
              ? sourceFormat('bold')
              : void editor?.chain().focus().toggleBold().run(),
          source ? undefined : state?.bold,
        )}
        {action(
          '기울임 (Ctrl+I)',
          <Italic size={16} />,
          () =>
            source
              ? sourceFormat('italic')
              : void editor?.chain().focus().toggleItalic().run(),
          source ? undefined : state?.italic,
        )}
        {action('문서 링크 (Ctrl+K)', <Link2 size={16} />, openLinkPicker)}
        {(['list', 'insert', 'more'] as const).map((id) => (
          <button
            key={id}
            type="button"
            aria-label={{ list: '목록', insert: '삽입', more: '더 보기' }[id]}
            title={
              {
                list: '목록',
                insert: '표 · 구분선 · 인용 · 코드',
                more: '원문 · 도움말',
              }[id]
            }
            aria-expanded={menu === id}
            disabled={locked && id !== 'more'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => toggleMenu(id)}
          >
            {id === 'list' ? (
              <List size={17} />
            ) : id === 'insert' ? (
              <Plus size={17} />
            ) : (
              <MoreHorizontal size={17} />
            )}
          </button>
        ))}
        <span className="editor-tool-divider" />
        <button
          type="button"
          aria-label={focused ? '캔버스로 돌아가기' : '집중 편집'}
          title={focused ? '캔버스로 돌아가기 (Esc)' : '큰 화면에서 집중 편집'}
          onClick={() => {
            setFocused(!focused);
            setMenu(null);
          }}
        >
          {focused ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>
      {(menu || slash || linkRange) && (
        <div
          className="editor-menu"
          role={slash ? 'listbox' : 'group'}
          aria-label={slash ? '블록 삽입 명령' : '서식 옵션'}
        >
          {linkRange && (
            <DocumentLinkPicker
              currentCanvas={currentCanvas}
              query={linkRange.query}
              setQuery={(query) => {
                setLinkIndex(0);
                setLinkRange(
                  (current) => current && { ...current, query, trigger: false },
                );
              }}
              automatic={linkRange.automatic}
              setAutomatic={(automatic) =>
                setLinkRange((current) => current && { ...current, automatic })
              }
              label={linkRange.label}
              setLabel={(label) =>
                setLinkRange((current) => current && { ...current, label })
              }
              index={linkIndex}
              choose={applyLink}
              cancel={cancelLink}
              keyboard={(event) => {
                handleLinkKey(event);
              }}
              trigger={linkRange.trigger}
              existing={!!linkRange.href}
              unlink={() => applyLink()}
              open={() => {
                const href = linkRange.href;
                cancelLink();
                if (href) linksRef.current.open(href);
              }}
            />
          )}
          {menu === 'text' && (
            <>
              {menuItem('본문', () => runCommand('paragraph'), !state?.heading)}
              {[1, 2, 3, 4, 5, 6].map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`editor-heading-choice editor-heading-choice--${level}`}
                  aria-pressed={state?.heading === level}
                  disabled={locked}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    editor
                      ?.chain()
                      .focus()
                      .setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 })
                      .run();
                    setMenu(null);
                  }}
                >
                  제목 {level}
                  <small>{'#'.repeat(level)}</small>
                </button>
              ))}
            </>
          )}
          {menu === 'list' && (
            <>
              {menuItem(
                '글머리 목록',
                () => runCommand('bullet'),
                source ? undefined : state?.bullet,
              )}
              {menuItem(
                '번호 목록',
                () => runCommand('ordered'),
                source ? undefined : state?.ordered,
              )}
              {menuItem(
                '체크리스트',
                () => runCommand('task'),
                source ? undefined : state?.task,
              )}
            </>
          )}
          {menu === 'insert' && (
            <>
              {menuItem('표 삽입…', () => setMenu('table'))}
              {menuItem('구분선', () => runCommand('rule'))}
              {menuItem(
                '인용',
                () => runCommand('quote'),
                source ? undefined : state?.quote,
              )}
              {menuItem(
                '코드 블록',
                () => runCommand('code'),
                source ? undefined : state?.code,
              )}
              {state?.table &&
                !source &&
                menuItem('표 행·열 관리…', () => setMenu('table-edit'))}
            </>
          )}
          {menu === 'table' && (
            <>
              <strong>표 크기</strong>
              {source ? (
                <p>원문 모드는 기본 표를 삽입합니다.</p>
              ) : (
                <div className="editor-table-size">
                  <label>
                    행
                    <select
                      aria-label="표 행 수"
                      value={tableRows}
                      onChange={(e) => setTableRows(Number(e.target.value))}
                    >
                      {[2, 3, 4, 5, 6, 8, 10].map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    열
                    <select
                      aria-label="표 열 수"
                      value={tableCols}
                      onChange={(e) => setTableCols(Number(e.target.value))}
                    >
                      {[2, 3, 4, 5, 6, 8].map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              {menuItem('표 만들기', () => runCommand('table'))}
            </>
          )}
          {menu === 'table-edit' && (
            <>
              {menuItem('위에 행 추가', () => {
                editor?.chain().focus().addRowBefore().run();
              })}
              {menuItem('아래에 행 추가', () => {
                editor?.chain().focus().addRowAfter().run();
              })}
              {menuItem('왼쪽에 열 추가', () => {
                editor?.chain().focus().addColumnBefore().run();
              })}
              {menuItem('오른쪽에 열 추가', () => {
                editor?.chain().focus().addColumnAfter().run();
              })}
              {menuItem('현재 행 삭제', () => {
                editor?.chain().focus().deleteRow().run();
              })}
              {menuItem('현재 열 삭제', () => {
                editor?.chain().focus().deleteColumn().run();
              })}
              {menuItem('표 삭제', () => {
                editor?.chain().focus().deleteTable().run();
              })}
            </>
          )}
          {menu === 'more' && (
            <>
              {menuItem(
                '취소선',
                () =>
                  source
                    ? sourceFormat('strike')
                    : void editor?.chain().focus().toggleStrike().run(),
                source ? undefined : state?.strike,
              )}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (source) {
                    if (loadVisual(value)) setSource(false);
                  } else {
                    sourceHistory.current.reset();
                    setSource(true);
                    setWarning('');
                  }
                  setMenu(null);
                  setLinkRange(null);
                  restoreFocus();
                }}
              >
                {source ? '서식 편집으로 전환' : 'Markdown 원문 보기'}
              </button>
              <button type="button" onClick={() => setMenu('help')}>
                <HelpCircle size={15} />
                입력 도움말
              </button>
            </>
          )}
          {menu === 'help' && (
            <>
              <strong>입력 도움말</strong>
              <p>{MARKDOWN_HELP}</p>
              <p>
                / : 블록 메뉴 · Ctrl+B / I : 굵게 / 기울임 · Ctrl+Z : 실행 취소
                · Shift+Enter : 줄바꿈
              </p>
              <p>
                Enter: 목록 이어 쓰기 · 빈 항목에서 Enter: 종료 · Tab /
                Shift+Tab: 들여쓰기
              </p>
              <p>
                제목 수준과 서식은 Markdown으로 저장합니다. 원문 모드에서는
                기호를 그대로 편집합니다.
              </p>
            </>
          )}
          {slash && (
            <>
              <strong>/ {slash.query || '블록 추가'}</strong>
              {editorCommands(slash.query).map((command, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={index === slashIndex}
                  key={command.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => chooseSlash(command.id)}
                >
                  {command.label}
                </button>
              ))}
              {!editorCommands(slash.query).length && (
                <p>일치하는 명령이 없습니다.</p>
              )}
              <small>↑↓ 선택 · Enter 적용 · Esc 닫기</small>
            </>
          )}
        </div>
      )}
    </div>
  );
  const content = (
    <div
      className="markdown-editor"
      onKeyDown={(event) => {
        if (!event.isPropagationStopped() && !handleLinkKey(event))
          dismissMenus(event);
      }}
      onCompositionStart={() => {
        composing.current = true;
        onCompositionChange?.(true);
        setSlash(null);
        if (linkRangeRef.current?.trigger) setLinkRange(null);
      }}
      onCompositionEnd={() => {
        composing.current = false;
        onCompositionChange?.(false);
        requestAnimationFrame(updateSlash);
        requestAnimationFrame(() => updateLinkTrigger());
      }}
    >
      {warning && (
        <p className="markdown-editor-warning" role="status">
          {warning}
        </p>
      )}
      {source ? (
        <textarea
          ref={areaRef}
          aria-label="Markdown 내용"
          value={value}
          readOnly={locked}
          onChange={(e) => {
            if (locked) return;
            sourceHistory.current.record(
              {
                value,
                start: Math.min(value.length, e.target.selectionStart),
                end: Math.min(value.length, e.target.selectionEnd),
              },
              true,
            );
            lastEmitted.current = e.target.value;
            onChange(e.target.value);
            updateLinkTrigger(e.target.value, e.target.selectionStart);
          }}
          onSelect={() => updateLinkTrigger()}
          onKeyDown={(e) => {
            if (handleLinkKey(e)) return;
            if (
              !e.nativeEvent.isComposing &&
              !locked &&
              (e.ctrlKey || e.metaKey) &&
              ['z', 'y'].includes(e.key.toLowerCase())
            ) {
              e.preventDefault();
              e.stopPropagation();
              const area = e.currentTarget;
              const next = sourceHistory.current.move(
                e.key.toLowerCase() === 'y' || e.shiftKey ? 'redo' : 'undo',
                { value, start: area.selectionStart, end: area.selectionEnd },
              );
              if (next) {
                lastEmitted.current = next.value;
                onChange(next.value);
                requestAnimationFrame(() => {
                  area.focus();
                  area.setSelectionRange(next.start, next.end);
                });
              }
              return;
            }
            if (
              !e.nativeEvent.isComposing &&
              (e.ctrlKey || e.metaKey) &&
              ['b', 'i'].includes(e.key.toLowerCase()) &&
              !locked
            ) {
              e.preventDefault();
              e.stopPropagation();
              sourceFormat(e.key.toLowerCase() === 'b' ? 'bold' : 'italic');
            }
          }}
        />
      ) : (
        <EditorContent
          editor={editor}
          className="markdown-editor-content nowheel"
        />
      )}
      {!focused && (
        <span className="editor-inline-hint">
          {source
            ? 'Markdown 원문 · Ctrl+K 문서 링크'
            : '/ 블록 추가 · [[ 문서 링크 · Ctrl+K'}
        </span>
      )}
    </div>
  );
  return (
    <div ref={anchorRef} className="markdown-editor-anchor">
      {focused ? (
        <div className="editor-focus-placeholder">
          <Maximize2 size={20} />
          <span>집중 편집 중</span>
          <button type="button" onClick={closeFocus}>
            캔버스로 돌아가기
          </button>
        </div>
      ) : (
        content
      )}
      {createPortal(
        focused ? (
          <div
            className="editor-focus-backdrop"
            data-editor-owner={owner}
            onKeyDown={(event) => {
              dismissMenus(event);
              if (
                !event.isPropagationStopped() &&
                !event.nativeEvent.isComposing &&
                (event.ctrlKey || event.metaKey) &&
                ['s', 'Enter'].includes(event.key)
              ) {
                event.preventDefault();
                event.stopPropagation();
                if (event.key === 'Enter') onFinish();
                else onSave();
              }
            }}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="메모 집중 편집"
              className="editor-focus-dialog"
            >
              <header>
                <span>메모 집중 편집</span>
                <button
                  type="button"
                  aria-label="집중 편집 닫기"
                  onClick={closeFocus}
                >
                  <X size={18} />
                </button>
              </header>
              <input
                className="editor-focus-title"
                aria-label="집중 편집 문서 제목"
                value={title}
                onCompositionStart={() => {
                  composing.current = true;
                  onCompositionChange?.(true);
                }}
                onCompositionEnd={() => {
                  composing.current = false;
                  onCompositionChange?.(false);
                }}
                readOnly={locked}
                onChange={(e) => onTitle(e.target.value)}
              />
              {toolbar}
              {content}
              <footer>
                <span role="status">{status}</span>
                <button type="button" onClick={closeFocus}>
                  캔버스로
                </button>
                <button
                  type="button"
                  className="button-primary"
                  onClick={onFinish}
                >
                  편집 완료
                </button>
              </footer>
            </div>
          </div>
        ) : (
          toolbar
        ),
        document.body,
      )}
    </div>
  );
}
