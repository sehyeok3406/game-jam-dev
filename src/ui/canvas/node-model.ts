import type { CanvasNode } from '../workspace/workspace-types';

type Fields = Record<string, unknown>;
type Callback = (...args: unknown[]) => unknown;
type Binding = { current: Callback; invoke: Callback };
type Entry = {
  data: Fields;
  callbacks: Map<string, Binding>;
  generation?: string;
  active: boolean;
};

type AsyncKeys<T> = T extends unknown
  ? {
      [K in keyof T]-?: NonNullable<T[K]> extends (
        ...args: never[]
      ) => Promise<unknown>
        ? K
        : never;
    }[keyof T]
  : never;
// Exhaustive over the typed node contracts: a stale write must never look acknowledged.
const asynchronousCallbacks: Record<AsyncKeys<CanvasNode['data']>, true> = {
  onSave: true,
  onResize: true,
  onCopyTask: true,
  onReveal: true,
  beginEdit: true,
  endEdit: true,
  onWindowChange: true,
  onCommand: true,
  submit: true,
  openDescription: true,
  exportPng: true,
  move: true,
};
// React cleanup must release the original editor/gesture even after its view expires.
// These existing stable callbacks retain their owner rather than forwarding to a later one.
const cleanupCallbacks = new Set(['registerEditor', 'onGesture']);
export class StaleCanvasNodeError extends Error {
  constructor() {
    super('화면이 변경되어 작업을 중단했습니다.');
  }
}

/** Small projection records only: never walk document bodies, points or frame items. */
export function sameFields(left: Fields, right: Fields) {
  if (left === right) return true;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) => Object.hasOwn(right, key) && Object.is(left[key], right[key]),
    )
  );
}
function reuseFields(previous: unknown, next: unknown) {
  return previous &&
    next &&
    typeof previous === 'object' &&
    typeof next === 'object' &&
    Object.getPrototypeOf(previous) === Object.prototype &&
    Object.getPrototypeOf(next) === Object.prototype &&
    sameFields(previous as Fields, next as Fields)
    ? previous
    : next;
}

/** Per-visit UI bindings keep callbacks fresh without invalidating every node's data. */
export class CanvasNodeModels {
  private entries = new Map<string, Entry>();
  private visit?: () => boolean;

  prepare(nodes: CanvasNode[], current: () => boolean): CanvasNode[] {
    if (this.visit !== current) {
      for (const entry of this.entries.values()) entry.active = false;
      this.entries.clear();
      this.visit = current;
    }
    const present = new Set(nodes.map((node) => node.id));
    for (const [id, entry] of this.entries)
      if (!present.has(id)) {
        entry.active = false;
        this.entries.delete(id);
      }
    return nodes.map((node) => {
      const generation =
        node.data.kind === 'drawing'
          ? node.data.object.generation
          : node.data.kind === 'game-ui'
            ? node.data.frame.generation
            : undefined;
      let entry = this.entries.get(node.id);
      if (
        !entry ||
        entry.generation !== generation ||
        entry.data.kind !== node.data.kind
      ) {
        if (entry) entry.active = false;
        entry = { data: {}, callbacks: new Map(), generation, active: true };
        this.entries.set(node.id, entry);
      }
      const owner = entry;
      const data: Fields = {};
      for (const [key, value] of Object.entries(node.data)) {
        if (typeof value === 'function' && !cleanupCallbacks.has(key)) {
          let binding = owner.callbacks.get(key);
          if (!binding) {
            const cell: Binding = {
              current: value as Callback,
              invoke: (...args) => {
                if (
                  !owner.active ||
                  owner.callbacks.get(key) !== cell ||
                  !current()
                )
                  return Object.hasOwn(asynchronousCallbacks, key)
                    ? Promise.reject(new StaleCanvasNodeError())
                    : undefined;
                return cell.current(...args);
              },
            };
            binding = cell;
            owner.callbacks.set(key, binding);
          }
          binding.current = value as Callback;
          data[key] = binding.invoke;
        } else data[key] = reuseFields(owner.data[key], value);
      }
      for (const key of owner.callbacks.keys())
        if (typeof (node.data as Fields)[key] !== 'function')
          owner.callbacks.delete(key);
      owner.data = sameFields(owner.data, data) ? owner.data : data;
      return { ...node, data: owner.data } as CanvasNode;
    });
  }
}

/** Preserve independent React Flow geometry while reusing stable content data. */
export function reuseCanvasNode(
  previous: CanvasNode | undefined,
  next: CanvasNode,
): CanvasNode {
  if (!previous) return next;
  const result = {
    ...next,
    position: reuseFields(previous.position, next.position),
    style: reuseFields(previous.style, next.style),
  } as CanvasNode;
  return sameFields(previous, result) ? previous : result;
}
