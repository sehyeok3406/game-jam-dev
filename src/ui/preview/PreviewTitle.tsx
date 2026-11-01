import { useEffect, useRef, useState } from 'react';
import type { PreviewResult } from '../../contracts/preview';
import { documentName } from '../../core/documents/file-name';
import { useRuntime } from '../runtime/RuntimeProvider';

export function PreviewTitle({
  preview,
  locked,
}: {
  preview: PreviewResult;
  locked: boolean;
}) {
  const { api } = useRuntime();
  const display =
    preview.title?.trim() ||
    preview.relativePath.split('/').at(-1)!.slice(0, -5);
  const [value, setValue] = useState(display),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null),
    request = useRef(0);
  useEffect(() => {
    if (!editing) setValue(display);
  }, [display, editing]);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  const save = async () => {
    if (busy || locked) return;
    const ticket = ++request.current;
    setBusy(true);
    setError('');
    try {
      const name = documentName(value),
        workspace = await api.projects.getWorkspace();
      if (!workspace.saveScope || !preview.sourceId)
        throw Error('프로젝트와 HTML 결과를 다시 확인해주세요.');
      await api.saves.flushDocumentSaves(workspace.saveScope);
      const hash = [
        ...new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(preview.content),
          ),
        ),
      ]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const result = await api.editor.renamePreview({
        scope: workspace.saveScope,
        relativePath: preview.relativePath,
        objectId: preview.sourceId,
        expectedHash: hash,
        name,
      });
      if (ticket === request.current) {
        setValue(result.change.name);
        setEditing(false);
      }
    } catch (e) {
      if (ticket === request.current) setError((e as Error).message);
    } finally {
      if (ticket === request.current) setBusy(false);
    }
  };
  return (
    <>
      {editing ? (
        <input
          ref={input}
          className="canvas-file-header__title nodrag nowheel"
          aria-label="HTML 이름"
          aria-invalid={!!error}
          title="Enter로 파일 이름 변경 · Esc로 취소"
          value={value}
          readOnly={busy || locked}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            if (!busy && !error) void save();
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              if (!busy) {
                request.current++;
                setValue(display);
                setEditing(false);
                setError('');
              }
            }
            if (
              e.key === 'Enter' ||
              ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's')
            ) {
              e.preventDefault();
              e.stopPropagation();
              void save();
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="canvas-file-header__title nodrag"
          title={`${display}\n${preview.relativePath}`}
          aria-label={`HTML 이름 편집: ${display}`}
          aria-disabled={locked}
          data-find-section={`preview:${preview.identityPath ?? preview.relativePath}`}
          onClick={(e) => {
            if (!locked && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
              setValue(display);
              setEditing(true);
            }
          }}
          onKeyDown={(e) => {
            if (!locked && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              e.stopPropagation();
              setEditing(true);
            }
          }}
        >
          {display}
        </button>
      )}
      {(error || busy) && (
        <span
          className="file-name-message"
          title={error}
          role={error ? 'alert' : 'status'}
        >
          {error || '이름 변경 중…'}
        </span>
      )}
    </>
  );
}
