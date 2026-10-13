import {
  createContext,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import {
  DocumentLinkIndex,
  resolveDocumentLink,
  type LinkDocument,
} from '../document-links';
import type { CanvasDocument, CanvasSheet } from '../shared';

const DocumentLinksContext = createContext({
  documents: [] as readonly LinkDocument[],
  canvasName: (_id?: string): string => '기본 캔버스',
  resolve: (href: string) => resolveDocumentLink(href, []),
  open: (_href: string): void => {},
  backlinks: (_path: string): readonly LinkDocument[] => [],
});
export const useDocumentLinks = () => useContext(DocumentLinksContext);
export function DocumentLinksProvider({
  documents,
  canvases,
  open,
  children,
}: {
  documents: CanvasDocument[];
  canvases: CanvasSheet[];
  open: (href: string) => void;
  children: ReactNode;
}) {
  const index = useRef(new DocumentLinkIndex());
  const value = useMemo(() => {
    index.current.update(documents);
    return {
      documents,
      open,
      resolve: (href: string) => resolveDocumentLink(href, documents),
      canvasName: (id?: string) =>
        canvases.find((c) => c.id === (id ?? 'default'))?.name ?? '기본 캔버스',
      backlinks: (path: string) => {
        const target = documents.find((d) => d.relativePath === path);
        return target ? index.current.backlinks(target) : [];
      },
    };
  }, [documents, canvases, open]);
  return (
    <DocumentLinksContext.Provider value={value}>
      {children}
    </DocumentLinksContext.Provider>
  );
}
