export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpatialItem extends CanvasRect {
  id: string;
}

function valid(rect: CanvasRect) {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width >= 0 &&
    rect.height >= 0 &&
    Number.isFinite(rect.x + rect.width) &&
    Number.isFinite(rect.y + rect.height)
  );
}

export function intersects(a: CanvasRect, b: CanvasRect) {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

/** Geometry only. Oversized items/queries never allocate an unbounded grid. */
export class CanvasSpatialIndex {
  private items = new Map<string, SpatialItem>();
  private cells = new Map<string, Set<string>>();
  private memberships = new Map<string, string[] | null>();
  private oversized = new Set<string>();
  private cellSize: number;
  private cellLimit: number;
  revision = 0;

  constructor(cellSize = 1024, cellLimit = 256) {
    if (!(cellSize > 0) || !Number.isFinite(cellSize))
      throw new Error('Invalid spatial cell size');
    if (!Number.isSafeInteger(cellLimit) || cellLimit < 1)
      throw new Error('Invalid spatial cell limit');
    this.cellSize = cellSize;
    this.cellLimit = cellLimit;
  }

  get size() {
    return this.items.size;
  }

  ids() {
    return this.items.keys();
  }

  has(id: string) {
    return this.items.has(id);
  }

  get(id: string): Readonly<SpatialItem> | undefined {
    return this.items.get(id);
  }

  private keys(rect: CanvasRect): string[] | null {
    const left = Math.floor(rect.x / this.cellSize);
    const top = Math.floor(rect.y / this.cellSize);
    const right = Math.floor((rect.x + rect.width) / this.cellSize);
    const bottom = Math.floor((rect.y + rect.height) / this.cellSize);
    if (
      ![left, top, right, bottom].every(Number.isSafeInteger) ||
      (right - left + 1) * (bottom - top + 1) > this.cellLimit
    )
      return null;
    const keys: string[] = [];
    for (let x = left; x <= right; x++)
      for (let y = top; y <= bottom; y++) keys.push(`${x}:${y}`);
    return keys;
  }

  upsert(item: SpatialItem) {
    if (!valid(item)) return this.remove(item.id);
    const old = this.items.get(item.id);
    if (
      old &&
      old.x === item.x &&
      old.y === item.y &&
      old.width === item.width &&
      old.height === item.height
    )
      return false;
    this.remove(item.id);
    // Do not retain a caller-owned object or any document data it might carry.
    this.items.set(item.id, {
      id: item.id,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    });
    const keys = this.keys(item);
    this.memberships.set(item.id, keys);
    if (keys === null) this.oversized.add(item.id);
    else
      for (const key of keys) {
        let bucket = this.cells.get(key);
        if (!bucket) this.cells.set(key, (bucket = new Set()));
        bucket.add(item.id);
      }
    this.revision++;
    return true;
  }

  remove(id: string) {
    if (!this.items.delete(id)) return false;
    for (const key of this.memberships.get(id) ?? []) {
      const bucket = this.cells.get(key)!;
      bucket.delete(id);
      if (!bucket.size) this.cells.delete(key);
    }
    this.memberships.delete(id);
    this.oversized.delete(id);
    this.revision++;
    return true;
  }

  sync(items: Iterable<SpatialItem>) {
    const before = this.revision;
    const remaining = new Set(this.items.keys());
    for (const item of items) {
      remaining.delete(item.id);
      this.upsert(item);
    }
    for (const id of remaining) this.remove(id);
    return this.revision !== before;
  }

  query(rect: CanvasRect): Set<string> {
    const result = new Set<string>();
    if (!valid(rect)) return result;
    const keys = this.keys(rect);
    const candidates =
      keys === null
        ? this.items.keys()
        : new Set([
            ...this.oversized,
            ...keys.flatMap((key) => [...(this.cells.get(key) ?? [])]),
          ]);
    for (const id of candidates)
      if (intersects(this.items.get(id)!, rect)) result.add(id);
    return result;
  }
}
