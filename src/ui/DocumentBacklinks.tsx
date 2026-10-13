import { documentLinkHref } from '../document-links';
import { useDocumentLinks } from './DocumentLinksContext';
export function DocumentBacklinks({ path }: { path: string }) {
  const links = useDocumentLinks();
  const sources = links.backlinks(path);
  if (!sources.length) return null;
  return (
    <details
      className="source-list document-backlinks nodrag"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <summary>이 문서를 참조하는 문서 {sources.length}개</summary>
      {sources.map((source) => {
        let href = '';
        try {
          href = documentLinkHref(source);
        } catch {
          /* A malformed legacy record remains visible but cannot be opened by ID. */
        }
        return (
          <button
            type="button"
            disabled={!href}
            key={source.relativePath}
            onClick={(e) => {
              e.stopPropagation();
              if (href) links.open(href);
            }}
          >
            {source.title}
            <small>{links.canvasName(source.canvasId)}</small>
          </button>
        );
      })}
    </details>
  );
}
