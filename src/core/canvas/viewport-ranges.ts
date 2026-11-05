import { CanvasSpatialIndex, type CanvasRect } from './spatial-index.ts';

export interface CanvasCamera {
  x: number;
  y: number;
  zoom: number;
  width: number;
  height: number;
}

export interface CanvasViewportRanges {
  readonly visible: ReadonlySet<string>;
  readonly prepare: ReadonlySet<string>;
  readonly retain: ReadonlySet<string>;
}

export function cameraRect(camera: CanvasCamera): CanvasRect | null {
  if (
    !Object.values(camera).every(Number.isFinite) ||
    camera.zoom <= 0 ||
    camera.width <= 0 ||
    camera.height <= 0
  )
    return null;
  return {
    x: -camera.x / camera.zoom,
    y: -camera.y / camera.zoom,
    width: camera.width / camera.zoom,
    height: camera.height / camera.zoom,
  };
}

const expand = (rect: CanvasRect, margin: number): CanvasRect => ({
  x: rect.x - margin,
  y: rect.y - margin,
  width: rect.width + margin * 2,
  height: rect.height + margin * 2,
});

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

/** No timers or platform state: the caller supplies monotonic time. */
export class CanvasRangeTracker {
  private recent = new Map<string, number>();
  private snapshot: CanvasViewportRanges = {
    visible: new Set(),
    prepare: new Set(),
    retain: new Set(),
  };
  nextExpiry: number | null = null;

  getSnapshot = () => this.snapshot;

  update(
    index: CanvasSpatialIndex,
    camera: CanvasCamera,
    now: number,
    ahead: { x: number; y: number } = { x: 0, y: 0 },
  ) {
    const rect = cameraRect(camera);
    const visible = rect ? index.query(rect) : new Set<string>();
    const preparation = rect ? expand(rect, 512 / camera.zoom) : null;
    if (preparation) {
      const dx = Math.max(-512, Math.min(512, ahead.x)) / camera.zoom;
      const dy = Math.max(-512, Math.min(512, ahead.y)) / camera.zoom;
      preparation.x += Math.min(0, dx);
      preparation.y += Math.min(0, dy);
      preparation.width += Math.abs(dx);
      preparation.height += Math.abs(dy);
    }
    const prepare = preparation ? index.query(preparation) : new Set<string>();
    const retain = rect
      ? index.query(expand(rect, 1024 / camera.zoom))
      : new Set<string>();
    // Start the grace period when an item leaves preparation, even if the
    // camera sat still for a long time before the move. This is not a cache.
    for (const id of this.snapshot.prepare)
      if (!prepare.has(id) && index.has(id)) this.recent.set(id, now + 750);
    for (const id of prepare) this.recent.delete(id);
    this.nextExpiry = null;
    for (const [id, expiry] of this.recent) {
      if (!index.has(id) || expiry <= now) this.recent.delete(id);
      else {
        retain.add(id);
        this.nextExpiry = Math.min(this.nextExpiry ?? expiry, expiry);
      }
    }
    const changed =
      !sameSet(this.snapshot.visible, visible) ||
      !sameSet(this.snapshot.prepare, prepare) ||
      !sameSet(this.snapshot.retain, retain);
    if (changed) this.snapshot = { visible, prepare, retain };
    return changed;
  }
}
