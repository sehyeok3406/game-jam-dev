import type { InternalNode } from '@xyflow/react';
import { CanvasSpatialIndex } from '../../core/canvas/spatial-index.ts';
import {
  CanvasRangeTracker,
  type CanvasCamera,
} from '../../core/canvas/viewport-ranges.ts';
import type { CanvasNode } from '../workspace/workspace-types.ts';
import {
  CanvasCameraMotion,
  canvasDetail,
  type CanvasDetail,
  type PreparationTarget,
} from '../../core/canvas/preparation-policy.ts';
import { CanvasPreparationScheduler } from './preparation-scheduler.ts';
import { CanvasContentCache } from './content-cache.ts';

export interface ViewportClock {
  frame: (callback: (timestamp: number) => void) => number;
  cancelFrame: (id: number) => void;
  delay: (callback: () => void, ms: number) => number;
  cancelDelay: (id: number) => void;
  now: () => number;
}

export interface ViewportInput {
  camera: CanvasCamera;
  nodes: Iterable<InternalNode<CanvasNode>>;
  priorityIds?: readonly string[];
}

export interface CanvasPreparationSnapshot {
  readonly targets: ReadonlyMap<string, PreparationTarget>;
  readonly moving: boolean;
  readonly fast: boolean;
}

/** React Flow owns absolute positions, including section offsets and origin. */
export function* canvasSpatialItems(nodes: Iterable<InternalNode<CanvasNode>>) {
  for (const node of nodes) {
    if (
      node.hidden ||
      (node.data.kind === 'document' && node.data.sectionHidden)
    )
      continue;
    yield {
      id: node.id,
      x: node.internals.positionAbsolute.x,
      y: node.internals.positionAbsolute.y,
      width:
        node.measured?.width ??
        node.width ??
        node.initialWidth ??
        Number(node.style?.width ?? 0),
      height:
        node.measured?.height ??
        node.height ??
        node.initialHeight ??
        Number(node.style?.height ?? 0),
    };
  }
}

/** An instance belongs to one canvas visit, not the project save model. */
export class CanvasViewportStore {
  private index = new CanvasSpatialIndex();
  private ranges = new CanvasRangeTracker();
  private listeners = new Set<() => void>();
  private frame: number | null = null;
  private expiry: number | null = null;
  private geometryDirty = true;
  private clock: ViewportClock | null = null;
  private read: (() => ViewportInput) | null = null;
  private generation = 0;
  private current: () => boolean;
  private motion = new CanvasCameraMotion();
  private levels = new Map<string, CanvasDetail>();
  private urgent = new Set<string>();
  private soleSelected: string | undefined;
  private preparationListeners = new Set<() => void>();
  private preparation: CanvasPreparationSnapshot = {
    targets: new Map(),
    moving: false,
    fast: false,
  };
  readonly preparations = new CanvasPreparationScheduler();
  readonly content = new CanvasContentCache();
  readonly viewKey: string;
  private protectedNodes = new Map<string, Set<symbol>>();
  private search = false;

  protect(id: string) {
    const owner = Symbol(id);
    let owners = this.protectedNodes.get(id);
    if (!owners) this.protectedNodes.set(id, (owners = new Set()));
    owners.add(owner);
    this.schedule();
    return () => {
      owners.delete(owner);
      if (!owners.size && this.protectedNodes.get(id) === owners)
        this.protectedNodes.delete(id);
      this.schedule();
    };
  }
  setSearch(value: boolean) {
    if (this.search !== value) {
      this.search = value;
      this.schedule();
    }
  }
  isSoleSelected(id: string) {
    return this.current() && this.soleSelected === id;
  }
  contentMode(id: string): 0 | 1 | 2 | 3 {
    if (!this.current()) return 0;
    if (this.search || this.protectedNodes.has(id)) return 2;
    const target = this.preparation.targets.get(id);
    if (target) return target.level === 'detail' ? 2 : 1;
    return this.ranges.getSnapshot().retain.has(id) ? 3 : 0;
  }

  constructor(current: () => boolean = () => true, viewKey = '') {
    this.current = current;
    this.viewKey = viewKey;
  }

  getPreparationSnapshot = () => this.preparation;
  subscribePreparation = (listener: () => void) => {
    this.preparationListeners.add(listener);
    return () => {
      this.preparationListeners.delete(listener);
    };
  };

  getSnapshot = () => this.ranges.getSnapshot();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  connect(read: () => ViewportInput, clock: ViewportClock) {
    this.disconnect();
    this.read = read;
    this.clock = clock;
    this.geometryDirty = true;
    this.preparations.connect(clock, this.current);
    this.schedule();
    const visit = this.generation;
    return () => {
      if (this.generation === visit) this.disconnect();
    };
  }

  private disconnect() {
    if (this.frame !== null) this.clock?.cancelFrame(this.frame);
    if (this.expiry !== null) this.clock?.cancelDelay(this.expiry);
    this.frame = this.expiry = null;
    this.read = this.clock = null;
    this.index = new CanvasSpatialIndex();
    this.ranges = new CanvasRangeTracker();
    this.motion = new CanvasCameraMotion();
    this.levels.clear();
    this.urgent.clear();
    this.soleSelected = undefined;
    this.preparation = { targets: new Map(), moving: false, fast: false };
    this.preparations.stop();
    this.content.clear();
    this.generation++;
  }

  geometryChanged = () => {
    this.geometryDirty = true;
    this.schedule();
  };

  schedule = () => {
    this.preparations.invalidatePlan();
    if (!this.clock || !this.read || !this.current() || this.frame !== null)
      return;
    const visit = this.generation;
    this.frame = this.clock.frame((timestamp) => {
      if (
        visit !== this.generation ||
        !this.read ||
        !this.clock ||
        !this.current()
      )
        return;
      this.frame = null;
      const { camera, nodes, priorityIds = [] } = this.read();
      let selectionChanged = false;
      if (this.geometryDirty) {
        const geometry = [...nodes];
        this.index.sync(canvasSpatialItems(geometry));
        this.urgent = new Set(
          geometry
            .filter((node) => node.dragging || node.resizing)
            .map((node) => node.id),
        );
        const selected = geometry.filter((node) => node.selected);
        const soleSelected = selected.length === 1 ? selected[0].id : undefined;
        selectionChanged = this.soleSelected !== soleSelected;
        this.soleSelected = soleSelected;
        if (selected.length === 1) this.urgent.add(selected[0].id);
        this.geometryDirty = false;
      }
      const now = this.clock.now();
      const motion = this.motion.sample(camera, now);
      const changed = this.ranges.update(this.index, camera, now, {
        x: motion.aheadX,
        y: motion.aheadY,
      });
      const ranges = this.ranges.getSnapshot();
      const urgent = new Set([
        ...this.urgent,
        ...priorityIds,
        ...this.protectedNodes.keys(),
      ]);
      const targets = new Map<string, PreparationTarget>();
      for (const id of new Set([
        ...ranges.prepare,
        ...urgent,
        ...(this.search ? this.index.ids() : []),
      ])) {
        const rect = this.index.get(id);
        if (!rect) continue;
        const quality = canvasDetail(this.levels.get(id), camera.zoom, rect);
        this.levels.set(id, quality);
        const priority = urgent.has(id) ? 0 : ranges.visible.has(id) ? 1 : 2;
        const level =
          priority === 0 || this.search
            ? 'detail'
            : motion.fast
              ? 'summary'
              : quality;
        const cx = (rect.x + rect.width / 2) * camera.zoom + camera.x;
        const cy = (rect.y + rect.height / 2) * camera.zoom + camera.y;
        targets.set(id, {
          id,
          level,
          priority,
          distance: Math.hypot(cx - camera.width / 2, cy - camera.height / 2),
        });
      }
      for (const id of this.levels.keys())
        if (!ranges.retain.has(id) && !urgent.has(id)) this.levels.delete(id);
      const previous = this.preparation;
      const preparationChanged =
        selectionChanged ||
        previous.fast !== motion.fast ||
        previous.moving !== motion.moving ||
        previous.targets.size !== targets.size ||
        [...targets].some(([id, target]) => {
          const old = previous.targets.get(id);
          return (
            !old ||
            old.level !== target.level ||
            old.priority !== target.priority ||
            old.distance !== target.distance
          );
        });
      if (preparationChanged)
        this.preparation = {
          targets,
          moving: motion.moving,
          fast: motion.fast,
        };
      this.preparations.setTargets([...targets.values()], motion.moving);
      this.preparations.flushFrame(timestamp ?? this.clock.now());
      if (this.expiry !== null) this.clock.cancelDelay(this.expiry);
      this.expiry = null;
      const wakeAt = Math.min(
        this.ranges.nextExpiry ?? Infinity,
        motion.settleAt ?? Infinity,
      );
      if (Number.isFinite(wakeAt))
        this.expiry = this.clock.delay(
          () => {
            if (visit !== this.generation) return;
            this.expiry = null;
            this.schedule();
          },
          Math.max(1, wakeAt - now),
        );
      if (changed) for (const listener of this.listeners) listener();
      if (preparationChanged)
        for (const listener of this.preparationListeners) listener();
    });
  };
}
