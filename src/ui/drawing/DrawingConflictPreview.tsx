import { readDrawingFile } from '../../drawing-model';
import { drawingBounds } from '../../drawing-geometry';
import { drawingName } from '../../drawing-types';
import { DrawingGraphic } from './DrawingNode';
export function DrawingConflictPreview({
  path,
  content,
}: {
  path: string;
  content: string | null;
}) {
  if (content === null) return <p>이 버전에서는 삭제됨</p>;
  try {
    const objects = readDrawingFile(
      content,
      path.slice('.canvas/drawings/'.length, -5),
    ).objects;
    if (!objects.length) return <p>빈 그림 캔버스</p>;
    const bounds = objects.map(drawingBounds),
      x = Math.min(...bounds.map((b) => b.x)),
      y = Math.min(...bounds.map((b) => b.y)),
      w = Math.max(...bounds.map((b) => b.x + b.width)) - x,
      h = Math.max(...bounds.map((b) => b.y + b.height)) - y;
    return (
      <>
        <svg
          className="drawing-conflict-preview"
          viewBox={`${x - 8} ${y - 8} ${w + 16} ${h + 16}`}
          role="img"
          aria-label="병합할 그림 미리보기"
        >
          {objects.map((o) => (
            <g
              key={o.id}
              transform={`translate(${o.transform.x} ${o.transform.y}) rotate(${o.transform.rotation} ${o.transform.width / 2} ${o.transform.height / 2})`}
            >
              <DrawingGraphic object={o} />
            </g>
          ))}
        </svg>
        <small>
          {objects.length}개 그림 · 충돌하지 않는 그림과 속성은 두 선택에 모두
          유지됩니다.
        </small>
        <details>
          <summary>그림 목록</summary>
          <ul>
            {objects.map((o) => (
              <li key={o.id}>
                {drawingName(o)} · {o.id.slice(0, 8)}
              </li>
            ))}
          </ul>
        </details>
      </>
    );
  } catch {
    return <p>그림 미리보기를 읽을 수 없습니다.</p>;
  }
}
