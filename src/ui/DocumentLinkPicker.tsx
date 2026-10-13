import { useEffect, useRef, useId } from 'react';
import {
  documentLinkHref,
  searchLinkDocuments,
  type LinkDocument,
} from '../document-links';
import { useDocumentLinks } from './DocumentLinksContext';
export function DocumentLinkPicker({
  query,
  setQuery,
  automatic,
  setAutomatic,
  label,
  setLabel,
  currentCanvas,
  index,
  choose,
  cancel,
  keyboard,
  trigger,
  existing,
  unlink,
  open,
}: {
  query: string;
  setQuery: (q: string) => void;
  automatic: boolean;
  setAutomatic: (value: boolean) => void;
  label: string;
  setLabel: (value: string) => void;
  currentCanvas?: string;
  index: number;
  choose: (document: LinkDocument) => void;
  cancel: () => void;
  keyboard: (event: React.KeyboardEvent) => void;
  trigger: boolean;
  existing: boolean;
  unlink: () => void;
  open: () => void;
}) {
  const links = useDocumentLinks();
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const results = searchLinkDocuments(links.documents, query, currentCanvas);
  useEffect(() => {
    if (!trigger) input.current?.focus();
  }, [trigger]);
  return (
    <div
      className="document-link-picker"
      role="group"
      aria-label="문서 링크"
      onKeyDown={keyboard}
    >
      <strong>{existing ? '문서 링크 수정' : '다른 문서 연결'}</strong>
      <input
        ref={input}
        aria-label="연결할 문서 검색"
        placeholder="문서 제목 검색"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-controls={listId}
      />
      <label className="document-link-option">
        <input
          type="checkbox"
          checked={automatic}
          onChange={(e) => setAutomatic(e.target.checked)}
        />
        문서 제목 자동 갱신
      </label>
      {!automatic && (
        <input
          aria-label="링크 표시 문구"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="표시할 문구"
        />
      )}
      <div role="listbox" id={listId} aria-label="연결할 문서 목록">
        {results.map((doc, i) => {
          const usable =
            links.resolve(documentLinkHref(doc)).status === 'found';
          return (
            <button
              type="button"
              role="option"
              aria-selected={i === index}
              disabled={!usable}
              key={doc.relativePath}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(doc)}
            >
              <span>{doc.title}</span>
              <small>
                {links.canvasName(doc.canvasId)} · {doc.relativePath}
              </small>
              {doc.identitySource === 'path' && (
                <small>파일 이동 시 연결이 끊길 수 있음</small>
              )}
              {!usable && <small>중복 식별자</small>}
            </button>
          );
        })}
        {!results.length && <p role="status">일치하는 문서가 없습니다.</p>}
      </div>
      <small>↑↓ 선택 · Enter 연결 · Esc 취소 · 최대 20개 표시</small>
      <div className="document-link-actions">
        {existing && (
          <>
            <button type="button" onClick={open}>
              열기
            </button>
            <button type="button" onClick={unlink}>
              연결 해제
            </button>
          </>
        )}
        <button type="button" onClick={cancel}>
          취소
        </button>
      </div>
    </div>
  );
}
