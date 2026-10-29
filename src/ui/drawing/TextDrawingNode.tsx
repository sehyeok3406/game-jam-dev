import { memo, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  NodeResizer,
  NodeToolbar,
  Position,
  type NodeProps,
} from '@xyflow/react';
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Check,
  Copy,
  Trash2,
} from 'lucide-react';
import type { TextObject } from '../../drawing-types';
import {
  EMPTY_TEXT_DOCUMENT,
  isEmptyTextDocument,
  validateTextDocument,
} from '../../text-document';
import { validateDrawingObject } from '../../drawing-model';
import { useRuntime } from '../runtime/runtime-context';
import type { DrawingCanvasNode } from './DrawingNode';
import './text-drawing.css';
import {
  CanvasTextAlignment,
  alignCanvasText,
  canvasTextAlignment,
  serializeCanvasText,
} from './text-alignment';

export const TextDrawingNode = memo(function TextDrawingNode({
  data,
  selected,
  object,
}: Pick<NodeProps<DrawingCanvasNode>, 'data' | 'selected'> & {
  object: TextObject;
}) {
  const { api } = useRuntime();
  const [editing, setEditing] = useState(false),
    [error, setError] = useState('');
  const [geometry, setGeometry] = useState(object.geometry);
  const [loaded, setLoaded] = useState(false);
  const [recovered, setRecovered] = useState<TextObject['geometry'] | null>(
    null,
  );
  const latest = useRef(data);
  latest.current = data;
  const local = useRef(object.geometry),
    base = useRef(object.geometry);
  const dirty = useRef(false),
    saving = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const sequence = useRef(Date.now()),
    ready = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const mounted = useRef(true),
    editingSession = useRef(false),
    editEpoch = useRef(0);
  const finishAfterComposition = useRef(false);
  const finishAfterLoad = useRef(false);
  const finishing = useRef(false);
  const key = `canvas-text:${data.scope}:${object.id}`;
  const callbacks = useRef({
    changed: (_document: string) => {},
    flush: async () => {},
    finish: () => {},
  });
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        link: false,
        trailingNode: false,
      }),
      CanvasTextAlignment,
    ],
    content: JSON.parse(object.geometry.document),
    editable: false,
    editorProps: {
      attributes: {
        'aria-label': '캔버스 텍스트 내용',
        role: 'textbox',
        'aria-multiline': 'true',
        spellcheck: 'false',
      },
    },
    onUpdate: ({ editor }) =>
      callbacks.current.changed(serializeCanvasText(editor.getJSON())),
  });
  const marks = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive('bold'),
      italic: editor?.isActive('italic'),
      underline: editor?.isActive('underline'),
      bullet: editor?.isActive('bulletList'),
      ordered: editor?.isActive('orderedList'),
      align: editor
        ? canvasTextAlignment(editor.state, geometry.align, !editing)
        : null,
    }),
  });
  const backup = async () => {
    if (!data.scope) return;
    await api.saves.setEditorDraft(
      key,
      {
        title: '캔버스 텍스트 복구',
        body: JSON.stringify({ geometry: local.current, base: base.current }),
        sequence: ++sequence.current,
      },
      sequence.current,
    );
  };
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    const next = chain.current
      .catch(() => undefined)
      .then(async () => {
        if (!dirty.current || !editor || !ready.current) return;
        saving.current = true;
        const value = local.current;
        try {
          validateTextDocument(value.document);
          await backup();
          const height = editor.isDestroyed
            ? latest.current.object.transform.height
            : Math.min(
                100_000,
                Math.max(
                  42,
                  Math.ceil(
                    editor.view.dom.getBoundingClientRect().height /
                      latest.current.zoom,
                  ),
                ),
              );
          const current = latest.current.object;
          const acknowledged =
            current.kind === 'text' &&
            JSON.stringify(current.geometry) === JSON.stringify(value);
          await latest.current.onSave({
            id: object.id,
            generation: object.generation,
            ...(!acknowledged
              ? { geometry: value, expectedGeometry: base.current }
              : {}),
            transform: { height },
          });
          base.current = value;
          if (local.current === value) {
            dirty.current = false;
            await api.saves.setEditorDraft(key, null, ++sequence.current);
          }
          setError('');
        } catch (failure) {
          setError(
            `텍스트 저장 실패: ${failure instanceof Error ? failure.message : String(failure)}`,
          );
          throw failure;
        } finally {
          saving.current = false;
        }
      });
    chain.current = next;
    return next;
  };
  const change = (next: TextObject['geometry']) => {
    local.current = next;
    dirty.current = true;
    setGeometry(next);
    void backup().catch((failure) => setError(String(failure)));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (editor?.view.composing) {
        change(local.current);
        return;
      }
      void callbacks.current.flush().catch(() => undefined);
    }, 450);
  };
  const finishEditing = () => {
    if (!editingSession.current || finishing.current) return;
    if (!ready.current) {
      finishAfterLoad.current = true;
      return;
    }
    if (editor?.view.composing) {
      finishAfterComposition.current = true;
      return;
    }
    editingSession.current = false;
    finishAfterComposition.current = false;
    setEditing(false);
    const epoch = editEpoch.current;
    const value = local.current;
    const destination = latest.current;
    finishing.current = true;
    void flush()
      .then(async () => {
        if (
          !mounted.current ||
          editEpoch.current !== epoch ||
          local.current !== value ||
          latest.current.scope !== destination.scope ||
          latest.current.locked ||
          recovered ||
          !isEmptyTextDocument(value.document)
        )
          return;
        await destination.onCommand({
          action: 'delete',
          targets: [
            {
              id: object.id,
              generation: object.generation,
              expectedGeometry: value,
            },
          ],
        });
        await api.saves.setEditorDraft(key, null, ++sequence.current);
      })
      .catch((failure) => setError(`텍스트 편집 종료 실패: ${String(failure)}`))
      .finally(() => {
        finishing.current = false;
      });
  };
  callbacks.current = {
    changed: (document) => change({ ...local.current, document }),
    flush,
    finish: finishEditing,
  };
  useEffect(() => {
    let active = true;
    mounted.current = true;
    if (!editor) return;
    void api.saves
      .getEditorDraft(key)
      .then(async (draft) => {
        if (!active || !draft) return;
        const saved = JSON.parse(draft.body) as {
          geometry: TextObject['geometry'];
          base: TextObject['geometry'];
        };
        validateTextDocument(saved.geometry.document);
        validateDrawingObject({ ...object, geometry: saved.geometry });
        if (
          JSON.stringify(object.geometry) === JSON.stringify(saved.geometry)
        ) {
          sequence.current = Math.max(sequence.current, draft.sequence);
          await api.saves.setEditorDraft(key, null, ++sequence.current);
          return;
        }
        // A changed server value must never be silently overwritten by a recovered draft.
        if (JSON.stringify(object.geometry) !== JSON.stringify(saved.base)) {
          setRecovered(saved.geometry);
          setError(
            '복구할 텍스트 초안이 있습니다. 다른 변경과 충돌하여 자동으로 덮어쓰지 않았습니다.',
          );
          return;
        }
        sequence.current = Math.max(sequence.current, draft.sequence);
        local.current = saved.geometry;
        base.current = saved.base;
        dirty.current = true;
        setGeometry(saved.geometry);
        editor?.commands.setContent(JSON.parse(saved.geometry.document), {
          emitUpdate: false,
        });
      })
      .catch((failure) => active && setError(String(failure)))
      .finally(() => {
        if (active) {
          ready.current = true;
          setLoaded(true);
          if (dirty.current)
            void callbacks.current.flush().catch(() => undefined);
          if (finishAfterLoad.current) callbacks.current.finish();
        }
      });
    const unregister = data.draftRegistry.register(key, () =>
      callbacks.current.flush(),
    );
    return () => {
      mounted.current = false;
      active = false;
      unregister();
      if (timer.current) clearTimeout(timer.current);
      void callbacks.current.flush().catch(() => undefined);
    };
  }, [editor, key]);
  useEffect(() => {
    if (!editor || dirty.current || saving.current) return;
    local.current = object.geometry;
    base.current = object.geometry;
    setGeometry(object.geometry);
    if (serializeCanvasText(editor.getJSON()) !== object.geometry.document)
      editor.commands.setContent(JSON.parse(object.geometry.document), {
        emitUpdate: false,
      });
  }, [editor, object.geometry]);
  useEffect(() => {
    if (data.locked) {
      editingSession.current = false;
      setEditing(false);
      void callbacks.current.flush().catch(() => undefined);
    } else if (!selected) callbacks.current.finish();
    else if (local.current.document === EMPTY_TEXT_DOCUMENT) {
      editingSession.current = true;
      editEpoch.current++;
      setEditing(true);
    }
  }, [selected, data.locked]);
  useEffect(() => {
    editor?.setEditable(editing && !data.locked && loaded, false);
    if (!editing || data.locked || !editor || !loaded) return;
    // React Flow focuses newly selected nodes too. Focus the editor after that pass.
    const focus = setTimeout(() => {
      if (!editor.isDestroyed) {
        editor.commands.focus('end');
        editor.view.dom.focus({ preventScroll: true });
      }
    }, 40);
    return () => clearTimeout(focus);
  }, [editor, editing, data.locked, loaded]);
  useEffect(() => {
    if (!editor) return;
    const observer = new ResizeObserver(() => {
      if (!ready.current || data.locked || saving.current) return;
      const height = Math.max(
        42,
        Math.ceil(
          editor.view.dom.getBoundingClientRect().height / latest.current.zoom,
        ),
      );
      if (Math.abs(height - latest.current.object.transform.height) > 1) {
        dirty.current = true;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(
          () => void callbacks.current.flush().catch(() => undefined),
          450,
        );
      }
    });
    observer.observe(editor.view.dom);
    return () => observer.disconnect();
  }, [editor, data.locked]);
  const startEditing = () => {
    if (!data.locked) {
      editingSession.current = true;
      editEpoch.current++;
      setEditing(true);
    }
  };
  const command = (fn: () => void) => {
    startEditing();
    fn();
  };
  return (
    <div
      ref={root}
      className={`canvas-text-node${editing ? ' canvas-text-node--editing nodrag nopan nowheel' : ''}`}
      style={
        {
          fontSize: geometry.fontSize,
          color: geometry.color,
          fontFamily: geometry.fontFamily,
          textAlign: geometry.align,
          '--canvas-text-align': geometry.align,
          opacity: object.style.opacity,
        } as import('react').CSSProperties
      }
      aria-label="캔버스 텍스트"
      onDoubleClick={(event) => {
        event.stopPropagation();
        startEditing();
      }}
      onContextMenu={(event) => {
        if (!editing) {
          event.preventDefault();
          data.onContext();
        }
      }}
      onKeyDown={(event) => {
        if (editing) {
          event.stopPropagation();
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            finishEditing();
          }
        }
      }}
      onBlur={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget as Node) &&
          !(event.relatedTarget as Element)?.closest?.('.canvas-text-toolbar')
        ) {
          finishEditing();
        }
      }}
      onCompositionEnd={() => {
        if (finishAfterComposition.current)
          setTimeout(() => callbacks.current.finish(), 30);
      }}
    >
      <NodeToolbar
        isVisible={!!selected && !data.locked}
        position={Position.Top}
        align="start"
      >
        <div
          className="canvas-text-toolbar floating-surface nodrag nopan nowheel"
          role="toolbar"
          aria-label="텍스트 서식"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <select
            aria-label="글꼴"
            value={geometry.fontFamily}
            onChange={(event) =>
              change({
                ...local.current,
                fontFamily: event.target
                  .value as TextObject['geometry']['fontFamily'],
              })
            }
          >
            <option value="sans-serif">기본 고딕</option>
            <option value="serif">명조</option>
            <option value="monospace">고정폭</option>
          </select>
          <input
            type="number"
            aria-label="글자 크기"
            min={8}
            max={144}
            value={geometry.fontSize}
            onChange={(event) => {
              const fontSize = Number(event.target.value);
              if (fontSize >= 8 && fontSize <= 144)
                change({ ...local.current, fontSize });
            }}
          />
          {(
            [
              [
                '굵게',
                Bold,
                marks?.bold,
                () => editor?.chain().focus().toggleBold().run(),
              ],
              [
                '기울임',
                Italic,
                marks?.italic,
                () => editor?.chain().focus().toggleItalic().run(),
              ],
              [
                '밑줄',
                Underline,
                marks?.underline,
                () => editor?.chain().focus().toggleUnderline().run(),
              ],
              [
                '글머리 기호 목록',
                List,
                marks?.bullet,
                () => editor?.chain().focus().toggleBulletList().run(),
              ],
              [
                '번호 목록',
                ListOrdered,
                marks?.ordered,
                () => editor?.chain().focus().toggleOrderedList().run(),
              ],
            ] as const
          ).map(([label, Icon, active, run]) => (
            <button
              key={label}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={!!active}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => command(run)}
            >
              <Icon size={17} />
            </button>
          ))}
          <input
            type="color"
            aria-label="글자 색상"
            value={geometry.color}
            onChange={(event) =>
              change({ ...local.current, color: event.target.value })
            }
          />
          {(
            [
              ['left', '왼쪽 정렬', AlignLeft],
              ['center', '가운데 정렬', AlignCenter],
              ['right', '오른쪽 정렬', AlignRight],
            ] as const
          ).map(([align, label, Icon]) => (
            <button
              key={align}
              aria-label={label}
              title={
                data.textAlignmentSupported === false
                  ? '줄별 텍스트 정렬을 사용하려면 협업 서버를 업데이트해주세요.'
                  : label
              }
              disabled={data.textAlignmentSupported === false}
              aria-pressed={marks?.align === align}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() =>
                command(() => {
                  const chain = editor?.chain().focus();
                  if (!editing) chain?.selectAll();
                  chain
                    ?.command((props) => alignCanvasText(props, align))
                    .run();
                })
              }
            >
              <Icon size={17} />
            </button>
          ))}
          <button
            title="텍스트 편집 완료"
            aria-label="텍스트 편집 완료"
            onClick={() => {
              finishEditing();
            }}
          >
            <Check size={17} />
          </button>
          <button
            title="텍스트 복제"
            aria-label="텍스트 복제"
            onClick={() => {
              void flush()
                .then(() => {
                  const now = Date.now();
                  return latest.current.onCommand({
                    action: 'create',
                    objects: [
                      {
                        ...object,
                        geometry: local.current,
                        id: crypto.randomUUID(),
                        generation: crypto.randomUUID(),
                        transform: {
                          ...latest.current.object.transform,
                          x: latest.current.object.transform.x + 32,
                          y: latest.current.object.transform.y + 32,
                        },
                        order: Math.min(1e9, object.order + 1),
                        createdAt: now,
                        updatedAt: now,
                      },
                    ],
                  });
                })
                .catch((failure) => setError(String(failure)));
            }}
          >
            <Copy size={17} />
          </button>
          <button
            title="텍스트 삭제"
            aria-label="텍스트 삭제"
            onClick={() => {
              void flush()
                .then(() =>
                  latest.current.onCommand({
                    action: 'delete',
                    targets: [{ id: object.id, generation: object.generation }],
                  }),
                )
                .catch((failure) => setError(String(failure)));
            }}
          >
            <Trash2 size={17} />
          </button>
        </div>
      </NodeToolbar>
      <NodeResizer
        isVisible={!!selected && !editing && !data.locked}
        minWidth={80}
        minHeight={42}
        onResizeEnd={(_event, position) => {
          void data
            .onSave({
              id: object.id,
              generation: object.generation,
              transform: {
                x: position.x,
                y: position.y,
                width: position.width,
                height: position.height,
              },
            })
            .catch((failure) => setError(String(failure)));
        }}
      />
      <EditorContent editor={editor} />
      {editing && editor?.isEmpty && (
        <span className="canvas-text-placeholder">텍스트 입력</span>
      )}
      {error && (
        <div className="canvas-text-error nodrag nopan" role="alert">
          {error}
          {recovered ? (
            <>
              <button
                disabled={data.locked}
                onClick={() => {
                  const current = latest.current.object;
                  if (current.kind !== 'text') return;
                  base.current = current.geometry;
                  editor?.commands.setContent(JSON.parse(recovered.document), {
                    emitUpdate: false,
                  });
                  change(recovered);
                  setRecovered(null);
                  setError('');
                }}
              >
                보관된 초안으로 복구
              </button>
              <button
                onClick={() => {
                  void api.saves
                    .setEditorDraft(key, null, ++sequence.current)
                    .then(() => {
                      setRecovered(null);
                      setError('');
                    })
                    .catch((failure) => setError(String(failure)));
                }}
              >
                초안 버리기
              </button>
            </>
          ) : (
            <button onClick={() => void flush().catch(() => undefined)}>
              다시 저장
            </button>
          )}
        </div>
      )}
    </div>
  );
});
