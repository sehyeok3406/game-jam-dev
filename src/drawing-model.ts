import type { Snapshot } from './project-store.ts';
import type {
  DrawingCommand,
  DrawingFile,
  DrawingObject,
  DrawingItem,
} from './drawing-types.ts';
import type { DrawingDelta } from './drawing-types.ts';
import { SHAPE_NAMES } from './drawing-types.ts';
import { visibleStroke, withErasure } from './drawing-geometry.ts';
import type { ErasureRegion, StrokeObject } from './drawing-types.ts';
export const MAX_ERASURE_VERTICES = 2_000;
export const MAX_CANVAS_ERASURE_VERTICES = 25_000;
export const MAX_STROKE_ERASURES = 128;
export function validateErasure(e: ErasureRegion) {
  if (
    !keys(e, ['id', 'polygons']) ||
    !uuid(e.id) ||
    !Array.isArray(e.polygons) ||
    !e.polygons.length
  )
    fail('지우기 영역이 올바르지 않습니다.');
  let count = 0;
  for (const polygon of e.polygons) {
    if (!Array.isArray(polygon) || !polygon.length) fail();
    for (const ring of polygon) {
      if (
        !Array.isArray(ring) ||
        ring.length < 4 ||
        (count += ring.length) > MAX_ERASURE_VERTICES
      )
        fail('지우기 영역의 점 한도입니다. 동작을 나누어 시도해주세요.');
      for (const p of ring)
        if (
          !Array.isArray(p) ||
          p.length !== 2 ||
          !p.every((n) => number(n, -1e12, 1e12))
        )
          fail();
      if (JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1))) fail();
    }
  }
  return count;
}
export function baseStrokeGeometry(g: DrawingObject['geometry']) {
  if (!('erasures' in g)) return g;
  const { erasures: _erasures, ...base } = g;
  return base;
}
export const DRAWING_DIRECTORY = '.canvas/drawings';
export const MAX_DRAWING_BYTES = 2_000_000;
export const MAX_DRAWING_POINTS = 5_000;
const uuid = (s: unknown) =>
  typeof s === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);
function fail(message = '그림 데이터가 올바르지 않습니다.'): never {
  throw new Error(message);
}
const number = (n: unknown, min: number, max: number) =>
  typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const keys = (v: unknown, allowed: string[]) =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).every((k) => allowed.includes(k));
export const isDrawingPath = (path: string) =>
  /^\.canvas\/drawings\/[a-zA-Z0-9_-]{1,100}\.json$/.test(path);
export const drawingPath = (canvasId: string) => {
  const path = `${DRAWING_DIRECTORY}/${canvasId}.json`;
  if (!isDrawingPath(path)) fail('그림 캔버스 ID가 올바르지 않습니다.');
  return path;
};
export function validateDrawingObject(o: DrawingObject) {
  if (
    !keys(o, [
      'id',
      'generation',
      'transform',
      'style',
      'layer',
      'order',
      'createdAt',
      'updatedAt',
      'kind',
      'geometry',
    ]) ||
    !uuid(o.id) ||
    !uuid(o.generation)
  )
    fail();
  const t = o.transform,
    s = o.style;
  if (
    !keys(t, ['x', 'y', 'width', 'height', 'rotation']) ||
    !number(t.x, -1e6, 1e6) ||
    !number(t.y, -1e6, 1e6) ||
    !number(t.width, 1, 1e5) ||
    !number(t.height, 1, 1e5) ||
    !number(t.rotation, 0, 359.999999)
  )
    fail('그림 좌표나 크기를 확인해주세요.');
  const color = (v: unknown) =>
    v === null || (typeof v === 'string' && /^#[a-f0-9]{6}$/i.test(v));
  if (
    !keys(s, ['fill', 'stroke', 'strokeWidth', 'opacity', 'strokePattern']) ||
    !color(s.fill) ||
    !color(s.stroke) ||
    !number(s.strokeWidth, 0.5, 128) ||
    !number(s.opacity, 0, 1) ||
    !['solid', 'dashed'].includes(s.strokePattern)
  )
    fail('그림 색이나 선 굵기를 확인해주세요.');
  if (
    !['background', 'annotation'].includes(o.layer) ||
    !number(o.order, 0, 1e9) ||
    !number(o.createdAt, 0, Number.MAX_SAFE_INTEGER) ||
    !number(o.updatedAt, 0, Number.MAX_SAFE_INTEGER)
  )
    fail();
  if (o.kind === 'shape') {
    const g = o.geometry;
    if (
      !keys(g, ['shape', 'cornerRadius', 'endpoints']) ||
      !Object.hasOwn(SHAPE_NAMES, g.shape)
    )
      fail();
    if (g.shape === 'rounded-rectangle') {
      if (!number(g.cornerRadius, 0, 1e5)) fail();
    } else if (g.cornerRadius !== undefined) fail();
    if (g.shape === 'line' || g.shape === 'arrow') {
      if (
        s.fill !== null ||
        !Array.isArray(g.endpoints) ||
        g.endpoints.length !== 2 ||
        g.endpoints.some(
          (p) =>
            !Array.isArray(p) ||
            p.length !== 2 ||
            !p.every((n) => number(n, 0, 1)),
        )
      )
        fail();
    } else if (g.endpoints !== undefined) fail();
  } else if (o.kind === 'stroke') {
    const g = o.geometry;
    if (
      !keys(g, [
        'brush',
        'sourceWidth',
        'sourceHeight',
        'points',
        'pressureEnabled',
        'rendererVersion',
        'erasures',
      ]) ||
      !['pen', 'highlighter'].includes(g.brush) ||
      !number(g.sourceWidth, 1, 1e5) ||
      !number(g.sourceHeight, 1, 1e5) ||
      g.rendererVersion !== 1 ||
      typeof g.pressureEnabled !== 'boolean' ||
      !Array.isArray(g.points) ||
      g.points.length < 1 ||
      g.points.length > MAX_DRAWING_POINTS ||
      s.fill !== null ||
      s.stroke === null ||
      s.strokePattern !== 'solid'
    )
      fail();
    for (const p of g.points)
      if (
        !Array.isArray(p) ||
        p.length !== 3 ||
        !number(p[0], 0, g.sourceWidth) ||
        !number(p[1], 0, g.sourceHeight) ||
        !number(p[2], 0, 1)
      )
        fail();
    if (g.erasures !== undefined) {
      if (
        !Array.isArray(g.erasures) ||
        g.erasures.length > MAX_STROKE_ERASURES ||
        new Set(g.erasures.map((e) => e.id)).size !== g.erasures.length
      )
        fail('획의 지우기 횟수 한도입니다.');
      for (const e of g.erasures) validateErasure(e);
    }
  } else fail();
}
export function readDrawingFile(
  raw: string | undefined,
  canvasId: string,
): DrawingFile {
  if (raw === undefined) return { version: 1, canvasId, objects: [] };
  if (new TextEncoder().encode(raw).length > MAX_DRAWING_BYTES)
    fail('캔버스 그림은 2MB까지 저장할 수 있습니다.');
  let f: DrawingFile;
  try {
    f = JSON.parse(raw);
  } catch {
    return fail('그림 JSON을 읽을 수 없습니다. 원본 파일을 확인해주세요.');
  }
  if (
    !keys(f, ['version', 'canvasId', 'objects']) ||
    ![1, 2].includes(f.version) ||
    f.canvasId !== canvasId ||
    !Array.isArray(f.objects) ||
    f.objects.length > 1000
  )
    fail('그림 형식·캔버스·객체 한도를 확인해주세요.');
  const ids = new Set<string>();
  let points = 0,
    erasePoints = 0;
  for (const o of f.objects) {
    validateDrawingObject(o);
    if (ids.has(o.id)) fail('그림 ID가 중복되었습니다.');
    ids.add(o.id);
    if (o.kind === 'stroke') {
      points += o.geometry.points.length;
      if (o.geometry.erasures?.length && f.version !== 2)
        fail('부분 지우기는 그림 형식 2가 필요합니다.');
      for (const e of o.geometry.erasures ?? [])
        erasePoints += validateErasure(e);
    }
  }
  if (points > 50_000)
    fail('캔버스의 그림 점은 50,000개까지 저장할 수 있습니다.');
  if (erasePoints > MAX_CANVAS_ERASURE_VERTICES)
    fail('캔버스의 지우기 영역 한도입니다.');
  return f;
}
export function serializeDrawing(f: DrawingFile) {
  const raw =
    JSON.stringify({
      version:
        f.version === 2 ||
        f.objects.some(
          (o) => o.kind === 'stroke' && o.geometry.erasures?.length,
        )
          ? 2
          : 1,
      canvasId: f.canvasId,
      objects: [...f.objects].sort(
        (a, b) => a.order - b.order || a.id.localeCompare(b.id),
      ),
    }) + '\n';
  readDrawingFile(raw, f.canvasId);
  return raw;
}
export function snapshotDrawings(files: Snapshot): DrawingItem[] {
  const ids = new Set<string>();
  return Object.entries(files)
    .filter(([p]) => isDrawingPath(p))
    .flatMap(([p, raw]) => {
      const c = p.slice(DRAWING_DIRECTORY.length + 1, -5);
      return readDrawingFile(raw, c).objects.map((o) => {
        if (ids.has(o.id)) fail('프로젝트의 그림 ID가 중복되었습니다.');
        ids.add(o.id);
        return { ...o, canvasId: c };
      });
    });
}
export function applyDrawing(files: Snapshot, input: DrawingCommand): Snapshot {
  if (
    !input ||
    !keys(input, [
      'scope',
      'requestId',
      'canvasId',
      'action',
      'objects',
      'patches',
      'targets',
      'targetCanvasId',
      'erasures',
    ])
  )
    fail();
  if (input.requestId !== undefined && !uuid(input.requestId))
    fail('그림 작업 ID를 확인해주세요.');
  const path = drawingPath(input.canvasId),
    f = readDrawingFile(files[path], input.canvasId);
  const next = { ...files };
  if (input.action === 'create') {
    if (!input.objects?.length || input.objects.length > 1000) fail();
    const used = new Set(snapshotDrawings(files).map((o) => o.id));
    for (const o of input.objects) {
      validateDrawingObject(o);
      if (used.has(o.id)) fail('이미 존재하는 그림입니다.');
      used.add(o.id);
      f.objects.push(o);
    }
  } else if (input.action === 'erase') {
    if (
      !Array.isArray(input.erasures) ||
      !input.erasures.length ||
      input.erasures.length > 1000 ||
      new Set(input.erasures.map((e) => e.id)).size !== input.erasures.length
    )
      fail();
    for (const e of input.erasures) {
      if (
        !keys(e, [
          'id',
          'generation',
          'expectedTransform',
          'expectedGeometry',
          'expectedStrokeWidth',
          'region',
        ])
      )
        fail();
      validateErasure(e.region);
      const index = f.objects.findIndex(
        (o) => o.id === e.id && o.generation === e.generation,
      );
      const o = f.objects[index];
      if (!o || o.kind !== 'stroke') fail('획이 삭제되거나 이동했습니다.');
      const existing = o.geometry.erasures?.find((v) => v.id === e.region.id);
      if (existing) {
        if (!same(existing, e.region)) fail('지우기 작업 ID가 충돌했습니다.');
        continue;
      }
      if (
        !same(o.transform, e.expectedTransform) ||
        !same(
          baseStrokeGeometry(o.geometry),
          baseStrokeGeometry(e.expectedGeometry),
        ) ||
        o.style.strokeWidth !== e.expectedStrokeWidth
      )
        fail('획의 위치나 모양이 변경되었습니다. 다시 시도해주세요.');
      const erased = withErasure(o, e.region);
      validateDrawingObject(erased);
      erased.updatedAt = Date.now();
      if (!visibleStroke(erased).length) f.objects.splice(index, 1);
      else f.objects[index] = erased;
    }
    f.version = 2;
  } else if (input.action === 'patch') {
    if (!input.patches?.length || input.patches.length > 1000) fail();
    for (const p of input.patches) {
      if (
        !keys(p, [
          'id',
          'generation',
          'transform',
          'style',
          'layer',
          'order',
          'geometry',
          'expectedGeometry',
        ])
      )
        fail();
      const o = f.objects.find(
        (o) => o.id === p.id && o.generation === p.generation,
      );
      if (!o) fail('그림이 삭제되거나 다른 캔버스로 이동했습니다.');
      if (
        p.geometry &&
        JSON.stringify(o.geometry) !== JSON.stringify(p.expectedGeometry)
      )
        fail('그림 모양이 변경되었습니다. 다시 선택해주세요.');
      if (p.transform) o.transform = { ...o.transform, ...p.transform };
      if (p.style) o.style = { ...o.style, ...p.style };
      if (p.layer !== undefined) o.layer = p.layer;
      if (p.order !== undefined) o.order = p.order;
      if (p.geometry) o.geometry = p.geometry as never;
      o.updatedAt = Date.now();
      validateDrawingObject(o);
    }
  } else if (input.action === 'delete' || input.action === 'move') {
    if (
      !input.targets?.length ||
      input.targets.length > 1000 ||
      new Set(input.targets.map((t) => t.id)).size !== input.targets.length
    )
      fail();
    const removed = input.targets.map(
      (t) =>
        f.objects.find((o) => o.id === t.id && o.generation === t.generation) ??
        fail('그림이 변경되었습니다. 다시 선택해주세요.'),
    );
    f.objects = f.objects.filter((o) => !removed.includes(o));
    if (input.action === 'move') {
      const target = input.targetCanvasId;
      if (!target || target === input.canvasId)
        fail('다른 캔버스를 선택해주세요.');
      const targetPath = drawingPath(target),
        to = readDrawingFile(next[targetPath], target);
      to.objects.push(
        ...removed.map((o) => ({
          ...o,
          generation: globalThis.crypto.randomUUID(),
          updatedAt: Date.now(),
        })),
      );
      next[targetPath] = serializeDrawing(to);
    }
  } else fail('허용되지 않은 그림 작업입니다.');
  next[path] = serializeDrawing(f);
  return next;
}

const groups = ['transform', 'style', 'geometry', 'layer', 'order'] as const;
export function drawingDelta(
  path: string,
  before: string | undefined,
  after: string | undefined,
): DrawingDelta {
  const c = path.slice(DRAWING_DIRECTORY.length + 1, -5),
    b = readDrawingFile(before, c),
    a = readDrawingFile(after, c),
    bm = new Map(b.objects.map((o) => [o.id, JSON.stringify(o)]));
  return {
    version: a.version,
    canvasId: c,
    upsert: a.objects.filter((o) => bm.get(o.id) !== JSON.stringify(o)),
    removed: b.objects
      .filter((o) => !a.objects.some((v) => v.id === o.id))
      .map((o) => o.id),
    deleted: after === undefined,
  };
}
export function applyDrawingDelta(
  files: Snapshot,
  path: string,
  delta: DrawingDelta,
) {
  if (!isDrawingPath(path) || drawingPath(delta.canvasId) !== path) fail();
  if (delta.deleted) {
    delete files[path];
    return;
  }
  const f = readDrawingFile(files[path], delta.canvasId),
    values = new Map(f.objects.map((o) => [o.id, o]));
  for (const id of delta.removed) values.delete(id);
  for (const o of delta.upsert) {
    validateDrawingObject(o);
    values.set(o.id, o);
  }
  files[path] = serializeDrawing({
    ...f,
    version: f.version === 2 || delta.version === 2 ? 2 : 1,
    objects: [...values.values()],
  });
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const logical = (o: DrawingObject) => ({
  kind: o.kind,
  transform: o.transform,
  style: o.style,
  geometry: o.geometry,
  layer: o.layer,
  order: o.order,
});
/** Conditional object/group merge used by undo and offline three-way reconciliation. */
export function mergeDrawingFile(
  path: string,
  base?: string,
  desired?: string,
  current?: string,
  restoring = false,
  choice?: 'local' | 'server',
): string | undefined {
  const c = path.slice(DRAWING_DIRECTORY.length + 1, -5);
  const b = readDrawingFile(base, c),
    d = readDrawingFile(desired, c),
    s = readDrawingFile(current, c);
  const bm = new Map(b.objects.map((o) => [o.id, o])),
    dm = new Map(d.objects.map((o) => [o.id, o])),
    sm = new Map(s.objects.map((o) => [o.id, o]));
  for (const id of new Set([...bm.keys(), ...dm.keys()])) {
    const old = bm.get(id),
      want = dm.get(id),
      now = sm.get(id);
    if (same(old, want)) continue;
    if (!old) {
      if (now && !same(logical(now), logical(want!))) {
        if (!choice) fail('같은 ID의 그림 생성이 충돌했습니다.');
        if (choice === 'local') sm.set(id, want!);
        continue;
      }
      if (!now)
        sm.set(id, {
          ...want!,
          generation: restoring
            ? globalThis.crypto.randomUUID()
            : want!.generation,
        });
    } else if (!want) {
      if (
        now &&
        (!same(logical(now), logical(old)) ||
          (!restoring && now.generation !== old.generation))
      ) {
        if (!choice) fail('삭제할 그림에 이후 변경이 있습니다.');
        if (choice === 'server') continue;
      }
      sm.delete(id);
    } else {
      if (
        !now ||
        now.kind !== old.kind ||
        (!restoring && now.generation !== old.generation)
      ) {
        if (!choice) fail('그림 삭제·이동과 충돌했습니다.');
        if (choice === 'local')
          sm.set(id, { ...want, generation: globalThis.crypto.randomUUID() });
        continue;
      }
      const merged = { ...now, updatedAt: Date.now() };
      for (const g of groups)
        if (!same(old[g], want[g])) {
          if (
            g === 'geometry' &&
            old.kind === 'stroke' &&
            want.kind === 'stroke' &&
            now.kind === 'stroke' &&
            same(
              baseStrokeGeometry(old.geometry),
              baseStrokeGeometry(want.geometry),
            ) &&
            same(
              baseStrokeGeometry(old.geometry),
              baseStrokeGeometry(now.geometry),
            )
          ) {
            const before = new Map(
              (old.geometry.erasures ?? []).map((e) => [e.id, e]),
            );
            const after = new Map(
              (want.geometry.erasures ?? []).map((e) => [e.id, e]),
            );
            const current = new Map(
              (now.geometry.erasures ?? []).map((e) => [e.id, e]),
            );
            for (const id of new Set([...before.keys(), ...after.keys()])) {
              if (same(before.get(id), after.get(id))) continue;
              if (
                current.has(id) &&
                !same(current.get(id), before.get(id)) &&
                !same(current.get(id), after.get(id))
              ) {
                if (!choice) fail('같은 지우기 영역의 변경이 충돌했습니다.');
                if (choice === 'server') continue;
              }
              if (after.has(id)) current.set(id, after.get(id)!);
              else current.delete(id);
            }
            const geometry = { ...now.geometry };
            if (current.size)
              geometry.erasures = [...current.values()].sort((a, b) =>
                a.id.localeCompare(b.id),
              );
            else delete geometry.erasures;
            (merged as StrokeObject).geometry = geometry;
            continue;
          }
          if (!same(now[g], old[g]) && !same(now[g], want[g])) {
            if (!choice)
              fail(`같은 그림 속성의 이후 변경과 충돌했습니다: ${g}`);
            if (choice === 'server') continue;
          }
          (merged as unknown as Record<string, unknown>)[g] = want[g];
        }
      sm.set(id, merged);
    }
  }
  if (!sm.size && desired === undefined) return undefined;
  return serializeDrawing({
    version: b.version === 2 || d.version === 2 || s.version === 2 ? 2 : 1,
    canvasId: c,
    objects: [...sm.values()],
  });
}
