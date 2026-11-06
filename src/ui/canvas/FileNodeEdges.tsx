import { useId, useMemo } from 'react';
import { useStore, ViewportPortal, type ReactFlowState } from '@xyflow/react';
import type { PreviewResult } from '../../contracts/preview';
import { fileNodeEdgePath } from '../../core/canvas/file-node-edge';
import { useDocumentLinks } from '../DocumentLinksContext';
import { previewNodeId, type CanvasNode } from '../workspace/workspace-types';

export function FileNodeEdges({
  previews,
  hover,
  all,
}: {
  previews: PreviewResult[];
  hover: string | null;
  all: boolean;
}) {
  const { documents, connections } = useDocumentLinks();
  const arrow = useId();
  const edges = useMemo(() => {
    const byPath = new Map(documents.map((doc) => [doc.relativePath, doc]));
    const htmlIds = new Map(
      previews.map((preview) => [preview.relativePath, previewNodeId(preview)]),
    );
    const idFor = (path: string) => {
      const doc = byPath.get(path);
      return doc?.htmlSource ? htmlIds.get(doc.htmlSource) : doc?.id;
    };
    const result = new Map<
      string,
      { id: string; from: string; to: string; kind: 'reference' | 'input' }
    >();
    const add = (
      from: string | undefined,
      to: string | undefined,
      kind: 'reference' | 'input',
    ) => {
      if (!from || !to || from === to) return;
      const id = JSON.stringify([from, to, kind]);
      result.set(id, { id, from, to, kind });
    };
    for (const link of connections)
      add(idFor(link.sourcePath), idFor(link.targetPath), 'reference');
    for (const preview of previews) {
      for (const item of preview.build?.documents ?? [])
        if (item.state !== 'missing' && item.state !== 'replaced')
          add(idFor(item.path), previewNodeId(preview), 'input');
    }
    return Array.from(result.values());
  }, [documents, connections, previews]);

  const visible = useStore(
    (state: ReactFlowState) => {
      const routes = [];
      for (const edge of edges) {
        const from = state.nodeLookup.get(edge.from);
        const to = state.nodeLookup.get(edge.to);
        if (
          !from ||
          !to ||
          [from, to].some(
            (node) =>
              node.hidden || node.className?.includes('section-member-hidden'),
          )
        )
          continue;
        const expanded = (node: typeof from) => {
          const data = node.data as CanvasNode['data'];
          return (
            (data.kind === 'document' &&
              !data.document.asset &&
              !data.document.collapsed) ||
            (data.kind === 'preview' && !data.windowState.collapsed)
          );
        };
        if (
          !all &&
          hover !== edge.from &&
          hover !== edge.to &&
          !expanded(from) &&
          !expanded(to)
        )
          continue;
        const a = from.measured;
        const b = to.measured;
        if (!a.width || !a.height || !b.width || !b.height) continue;
        const route = fileNodeEdgePath(
          {
            ...from.internals.positionAbsolute,
            width: a.width,
            height: a.height,
          },
          {
            ...to.internals.positionAbsolute,
            width: b.width,
            height: b.height,
          },
        );
        routes.push({ ...edge, ...route });
      }
      return routes;
    },
    (a, b) =>
      a.length === b.length &&
      a.every(
        (edge, index) => edge.id === b[index].id && edge.d === b[index].d,
      ),
  );

  if (!visible.length) return null;
  return (
    <ViewportPortal>
      <svg className="file-node-edges" aria-label="파일 연결선">
        <defs>
          <marker
            id={arrow}
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M1 1L7 4L1 7" fill="none" stroke="context-stroke" />
          </marker>
        </defs>
        {visible.map((edge) => (
          <g key={edge.id} data-file-edge={edge.kind}>
            <path d={edge.d} markerEnd={`url(#${arrow})`} />
            {!all && (
              <text x={edge.x} y={edge.y - 5}>
                {edge.kind === 'input' ? '제작 입력' : '참조'}
              </text>
            )}
          </g>
        ))}
      </svg>
    </ViewportPortal>
  );
}
