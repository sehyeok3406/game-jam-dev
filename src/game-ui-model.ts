import matter from './game-ui-markdown.ts';
import {
  GAME_UI_DIRECTORY,
  GAME_UI_KINDS,
  GAME_UI_SHAPES,
  type GameUiFrame,
  type GameUiItem,
  type GameUiCommand,
  type GameUiKind,
} from './game-ui-types.ts';
import { assertCanvas } from './canvas-sheets.ts';
import { GAME_UI_DETAIL_KEYS, validGameUiDetails } from './game-ui-details.ts';

type Files = Record<string, string>;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const finite = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const str = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length <= max;
function fail(message = '게임 UI 데이터가 올바르지 않습니다.'): never {
  throw new Error(message);
}
export const isGameUiPath = (p: string) =>
  /^\.canvas\/game-ui\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\.json$/i.test(
    p,
  );
export function gameUiPath(id: string) {
  if (!uuid(id)) fail();
  return `${GAME_UI_DIRECTORY}/${id}.json`;
}
export function readGameUi(raw: string, path?: string): GameUiFrame {
  let f: GameUiFrame;
  try {
    f = JSON.parse(raw);
  } catch {
    return fail();
  }
  if (
    !f ||
    f.version !== 1 ||
    !uuid(f.id) ||
    !uuid(f.generation) ||
    (path && path !== gameUiPath(f.id)) ||
    !str(f.canvasId, 100) ||
    !f.canvasId ||
    !str(f.title, 100) ||
    !f.title.trim() ||
    !finite(f.x, -1e6, 1e6) ||
    !finite(f.y, -1e6, 1e6) ||
    !finite(f.width, 320, 4000) ||
    !finite(f.viewportWidth, 64, 8192) ||
    !finite(f.viewportHeight, 64, 8192) ||
    !Number.isInteger(f.viewportWidth) ||
    !Number.isInteger(f.viewportHeight) ||
    f.viewportWidth * f.viewportHeight > 16_777_216 ||
    (f.backgroundColor !== undefined &&
      (typeof f.backgroundColor !== 'string' ||
        !/^#[a-f\d]{6}$/i.test(f.backgroundColor))) ||
    !Array.isArray(f.items) ||
    f.items.length > 500 ||
    !(
      f.descriptionPath === null || f.descriptionPath === `docs/ui/${f.id}.md`
    ) ||
    raw.length > 2_000_000
  )
    fail();
  const ids = new Set<string>(),
    names = new Set<string>();
  let slots = 0;
  for (const i of f.items) {
    if (
      !i ||
      !uuid(i.id) ||
      !uuid(i.generation) ||
      ids.has(i.id) ||
      !Object.hasOwn(GAME_UI_KINDS, i.kind) ||
      !str(i.name, 100) ||
      !i.name.trim() ||
      names.has(i.name) ||
      !finite(i.x, -1e6, 1e6) ||
      !finite(i.y, -1e6, 1e6) ||
      !finite(i.width, 8, 8192) ||
      !finite(i.height, 8, 8192) ||
      !Object.hasOwn(GAME_UI_SHAPES, i.shape) ||
      !/^#[a-f\d]{6}$/i.test(i.color) ||
      !str(i.text, 1000) ||
      !validGameUiDetails(i) ||
      !finite(i.maximum, -1e9, 1e9) ||
      i.maximum <= (i.minimum ?? 0) ||
      !finite(i.value, i.minimum ?? 0, i.maximum) ||
      !finite(i.count, 1, 32) ||
      !Number.isInteger(i.count) ||
      !finite(i.columns, 1, 32) ||
      !Number.isInteger(i.columns) ||
      !finite(i.gap, 0, 200) ||
      typeof i.locked !== 'boolean' ||
      !(i.groupId === null || uuid(i.groupId)) ||
      !Array.isArray(i.slots) ||
      i.slots.length > 32 ||
      i.slots.length < i.count
    )
      fail();
    const slotIds = new Set<string>();
    for (const s of i.slots) {
      if (
        !s ||
        !uuid(s.id) ||
        slotIds.has(s.id) ||
        !str(s.label, 100) ||
        !finite(s.quantity, 0, 1e9) ||
        !Number.isInteger(s.quantity) ||
        !finite(s.cooldown, 0, 100) ||
        (s.disabled !== undefined && typeof s.disabled !== 'boolean') ||
        ((s.cooldownTotal !== undefined || s.cooldownRemaining !== undefined) &&
          (!finite(s.cooldownTotal, 0.000001, 1e9) ||
            !finite(s.cooldownRemaining, 0, s.cooldownTotal)))
      )
        fail();
      slotIds.add(s.id);
    }
    if (!(i.selectedSlot === null || slotIds.has(i.selectedSlot))) fail();
    if (
      i.shape === 'ring' &&
      !['health', 'mana', 'stamina', 'experience'].includes(i.kind)
    )
      fail();
    ids.add(i.id);
    names.add(i.name);
    slots += i.slots.length;
  }
  if (slots > 1000) fail('게임 화면당 슬롯은 최대 1,000개입니다.');
  return f;
}
export function serializeGameUi(f: GameUiFrame) {
  const raw = JSON.stringify(f, null, 2) + '\n';
  readGameUi(raw);
  return raw;
}
export function snapshotGameUi(files: Files) {
  return Object.entries(files)
    .filter(([p]) => isGameUiPath(p))
    .map(([p, raw]) => readGameUi(raw, p));
}
export function newGameUiItem(
  kind: GameUiKind,
  ids: () => string,
  names: string[] = [],
): GameUiItem {
  const base = GAME_UI_KINDS[kind][0];
  let name: string = base,
    n = 2;
  while (names.includes(name)) name = `${base} ${n++}`;
  const bar = ['health', 'mana', 'stamina', 'experience'].includes(kind);
  const strip = kind === 'skills' || kind === 'items';
  const count = kind === 'skills' ? 4 : kind === 'items' ? 9 : 1;
  const slots = Array.from({ length: count }, (_, j) => ({
    id: ids(),
    label:
      kind === 'skills'
        ? (['Q', 'W', 'E', 'R'][j] ?? String(j + 1))
        : String(j + 1),
    quantity: 1,
    cooldown: 0,
  }));
  return {
    id: ids(),
    generation: ids(),
    kind,
    name,
    x: 40,
    y: 40,
    width: strip
      ? count * 64 + (count - 1) * 8
      : bar
        ? 300
        : kind === 'panel'
          ? 400
          : 180,
    height: strip
      ? 64
      : bar
        ? 40
        : kind === 'panel'
          ? 300
          : kind === 'image'
            ? 180
            : 60,
    shape: 'rounded',
    color: '#64748b',
    text: base,
    value: 75,
    maximum: 100,
    count,
    columns: count,
    gap: 8,
    selectedSlot: kind === 'items' ? slots[0].id : null,
    slots,
    groupId: null,
    locked: false,
  };
}
const escapeCell = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
const unescapeCell = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\\\|/g, '|')
    .replace(/\\\\/g, '\\');
function cells(line: string) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((s) => unescapeCell(s.trim()));
}
export function syncGameUiDescription(files: Files, f: GameUiFrame): Files {
  if (!f.descriptionPath || !files[f.descriptionPath]) return files;
  const parsed = matter(files[f.descriptionPath]);
  if (parsed.data.game_ui_frame !== f.id)
    fail('UI 설명 문서의 연결 정보를 확인해주세요.');
  const lines = parsed.content.split('\n');
  const start = lines.findIndex(
    (l, n) =>
      cells(l)[0] === 'UI 이름' &&
      cells(l)[1] === '기능 설명' &&
      /^\s*\|?[\s:|-]+\|/.test(lines[n + 1] ?? ''),
  );
  if (start < 0)
    fail(
      '연결된 UI 표를 찾을 수 없습니다. UI 이름 열과 기능 설명 열을 유지해주세요.',
    );
  let end = start + 2;
  const descriptions = new Map<string, string>();
  while (end < lines.length && lines[end].trim().startsWith('|')) {
    const c = cells(lines[end++]);
    if (c.length === 2) descriptions.set(c[0], c[1]);
  }
  const previous = parsed.data.game_ui_rows as
    | { id: string; name: string }[]
    | undefined;
  const byId = new Map(
    (Array.isArray(previous) ? previous : []).map((r) => [r.id, r.name]),
  );
  const rows = f.items.map((i) => {
    const oldName = byId.get(i.id);
    if (oldName && !descriptions.has(oldName))
      fail(
        'UI 이름은 게임 화면에서 바꿔주세요. 설명 문서의 원래 행을 복원한 뒤 다시 시도해주세요.',
      );
    return `| ${escapeCell(i.name)} | ${escapeCell(oldName ? descriptions.get(oldName)! : GAME_UI_KINDS[i.kind][1])} |`;
  });
  lines.splice(
    start,
    end - start,
    '| UI 이름 | 기능 설명 |',
    '| --- | --- |',
    ...rows,
  );
  const data = {
    ...parsed.data,
    game_ui_rows: f.items.map((i) => ({ id: i.id, name: i.name })),
  };
  return {
    ...files,
    [f.descriptionPath]: matter.stringify(lines.join('\n'), data),
  };
}
function comparePatch<T extends object>(
  target: T,
  changes: Partial<T>,
  expected?: Partial<T>,
) {
  if (
    !expected ||
    Object.keys(changes).some(
      (k) =>
        (!Object.hasOwn(expected, k) && Object.hasOwn(target, k)) ||
        (!same(target[k as keyof T], expected[k as keyof T]) &&
          !same(target[k as keyof T], changes[k as keyof T])),
    )
  )
    fail('다른 편집과 충돌했습니다. 최신 값을 확인한 뒤 다시 시도해주세요.');
}
function mergeSlots(
  base: GameUiItem['slots'],
  desired: GameUiItem['slots'],
  current: GameUiItem['slots'],
): GameUiItem['slots'] {
  if (!Array.isArray(base) || !Array.isArray(desired)) fail();
  if (same(base, current) || same(desired, current)) return desired;
  if (same(base, desired)) return current;
  if (base.length !== desired.length && base.length !== current.length)
    fail('슬롯 개수가 동시에 변경되었습니다.');
  const bm = new Map(base.map((s) => [s.id, s])),
    dm = new Map(desired.map((s) => [s.id, s])),
    cm = new Map(current.map((s) => [s.id, s]));
  const result: GameUiItem['slots'] = [];
  for (const id of new Set([
    ...current.map((s) => s.id),
    ...desired.map((s) => s.id),
  ])) {
    const b = bm.get(id),
      d = dm.get(id),
      c = cm.get(id);
    if (same(b, d)) {
      if (c) result.push(c);
      continue;
    }
    if (same(b, c) || same(d, c)) {
      if (d) result.push(d);
      continue;
    }
    if (!b || !d || !c) fail('슬롯 구조가 변경되었습니다.');
    const merged = { ...c };
    for (const keys of [
      ['label'],
      ['quantity'],
      ['disabled'],
      ['cooldown', 'cooldownTotal', 'cooldownRemaining'],
    ] as const) {
      const vals = (s: GameUiItem['slots'][number]) => keys.map((k) => s[k]);
      if (same(vals(b), vals(d))) continue;
      if (!same(vals(b), vals(c)) && !same(vals(d), vals(c)))
        fail('같은 슬롯 속성이 변경되었습니다.');
      for (const k of keys) Object.assign(merged, { [k]: d[k] });
    }
    result.push(merged);
  }
  return result;
}
export function applyGameUi(files: Files, c: GameUiCommand): Files {
  const path = gameUiPath(c.id);
  if (!uuid(c.generation)) fail();
  const next = { ...files };
  if (c.action === 'create') {
    if (!c.frame || c.frame.id !== c.id || c.frame.generation !== c.generation)
      fail();
    if (next[path]) {
      if (same(readGameUi(next[path]), c.frame)) return files;
      return fail('게임 화면 ID가 이미 존재합니다.');
    }
    assertCanvas(files, c.frame.canvasId);
    if (c.frame.descriptionPath !== null || snapshotGameUi(files).length >= 50)
      fail();
    next[path] = serializeGameUi(c.frame);
    return next;
  }
  if (!next[path]) fail('게임 화면이 삭제되었거나 이동했습니다.');
  const f = readGameUi(next[path]);
  if (f.generation !== c.generation) fail('이전 게임 화면의 변경 요청입니다.');
  if (c.action === 'delete') {
    delete next[path];
    return next;
  }
  if (c.action === 'frame') {
    const allowed = [
      'title',
      'x',
      'y',
      'width',
      'viewportWidth',
      'viewportHeight',
      'backgroundColor',
    ];
    if (!c.changes || Object.keys(c.changes).some((k) => !allowed.includes(k)))
      fail();
    comparePatch(f, c.changes, c.expected);
    Object.assign(f, c.changes);
  } else if (c.action === 'move') {
    assertCanvas(files, c.targetCanvasId);
    f.canvasId = c.targetCanvasId!;
    if (f.descriptionPath && next[f.descriptionPath]) {
      const d = matter(next[f.descriptionPath]);
      next[f.descriptionPath] = matter.stringify(d.content, {
        ...d.data,
        canvas_id: f.canvasId,
      });
    }
  } else if (c.action === 'add') {
    if (!c.items?.length) fail();
    for (const item of c.items) {
      const old = f.items.find((i) => i.id === item.id);
      if (old) {
        if (!same(old, item)) fail();
      } else f.items.push(structuredClone(item));
    }
  } else if (c.action === 'patch') {
    if (!c.patches?.length) fail();
    const seen = new Set<string>();
    for (const p of c.patches) {
      const i = f.items.find(
        (i) => i.id === p.id && i.generation === p.generation,
      );
      if (!i || seen.has(p.id)) fail('UI가 삭제되었거나 변경되었습니다.');
      seen.add(p.id);
      const allowed = [
        'name',
        'x',
        'y',
        'width',
        'height',
        'shape',
        'color',
        'text',
        'value',
        'maximum',
        'count',
        'columns',
        'gap',
        'selectedSlot',
        'slots',
        'groupId',
        'locked',
        ...GAME_UI_DETAIL_KEYS,
      ];
      if (Object.keys(p.changes).some((k) => !allowed.includes(k))) fail();
      if (i.locked && Object.keys(p.changes).some((k) => k !== 'locked'))
        fail('잠긴 UI는 먼저 잠금을 해제해주세요.');
      const changes = { ...p.changes },
        expected = { ...p.expected };
      const slots = changes.slots
        ? mergeSlots(expected.slots!, changes.slots, i.slots)
        : undefined;
      delete changes.slots;
      delete expected.slots;
      comparePatch(i, changes, expected);
      Object.assign(i, changes);
      if (slots) i.slots = slots;
    }
  } else if (c.action === 'remove') {
    if (!c.targets?.length) fail();
    for (const t of c.targets) {
      const i = f.items.find(
        (i) => i.id === t.id && i.generation === t.generation,
      );
      if (!i || i.locked) fail('삭제할 UI가 변경되었거나 잠겨 있습니다.');
    }
    const ids = new Set(c.targets.map((t) => t.id));
    f.items = f.items.filter((i) => !ids.has(i.id));
  } else if (c.action === 'describe') {
    f.descriptionPath = `docs/ui/${f.id}.md`;
    if (!next[f.descriptionPath]) {
      next[f.descriptionPath] = matter.stringify(
        `# ${f.title} — UI 설명\n\n## UI 목록\n\n| UI 이름 | 기능 설명 |\n| --- | --- |\n\n`,
        {
          id: f.id + '-description',
          title: `${f.title} — UI 설명`,
          type: 'reference',
          status: 'draft',
          canvas_id: f.canvasId,
          x: f.x + f.width + 40,
          y: f.y,
          width: 520,
          height: 400,
          game_ui_frame: f.id,
          game_ui_rows: [],
        },
      );
    }
  } else fail();
  next[path] = serializeGameUi(f);
  // Moving/resizing the frame must never rewrite a user's document editor.
  return c.action === 'describe' ||
    c.action === 'add' ||
    c.action === 'remove' ||
    (c.action === 'patch' &&
      c.patches?.some((p) => Object.hasOwn(p.changes, 'name')))
    ? syncGameUiDescription(next, f)
    : next;
}

/** Conditional, property-aware three-way merge for offline editing and Undo. */
export function mergeGameUi(
  base: string | undefined,
  desired: string | undefined,
  current: string | undefined,
  restoring = false,
): string | undefined {
  if (!restoring && (current === base || current === desired)) return desired;
  if (desired === base) return current;
  const logical = (a: unknown, b: unknown) =>
    JSON.stringify(a, (k, v) => (k === 'generation' ? undefined : v)) ===
    JSON.stringify(b, (k, v) => (k === 'generation' ? undefined : v));
  if (restoring && !base && desired && !current) {
    const f = readGameUi(desired);
    return serializeGameUi({
      ...f,
      generation: globalThis.crypto.randomUUID(),
      items: f.items.map((i) => ({
        ...i,
        generation: globalThis.crypto.randomUUID(),
      })),
    });
  }
  if (
    restoring &&
    base &&
    !desired &&
    current &&
    logical(readGameUi(base), readGameUi(current))
  )
    return undefined;
  if (!base || !desired || !current)
    fail('게임 화면 생성·삭제와 이후 편집이 충돌했습니다.');
  const b = readGameUi(base),
    d = readGameUi(desired),
    s = readGameUi(current);
  if (
    b.id !== d.id ||
    b.id !== s.id ||
    (!restoring &&
      (b.generation !== d.generation || b.generation !== s.generation))
  )
    fail();
  function mergeObject<T extends object>(
    bv: T,
    dv: T,
    sv: T,
    groups: string[][],
  ): T {
    const out = { ...sv };
    const grouped = new Set(groups.flat());
    for (const keys of [
      ...groups,
      ...Object.keys({ ...bv, ...dv, ...sv })
        .filter((k) => !grouped.has(k))
        .map((k) => [k]),
    ]) {
      const values = (v: T) => keys.map((k) => v[k as keyof T]);
      if (same(values(bv), values(dv))) continue;
      if (!same(values(bv), values(sv)) && !same(values(dv), values(sv)))
        fail('같은 UI 속성이 변경되어 병합할 수 없습니다.');
      for (const k of keys) out[k as keyof T] = dv[k as keyof T];
    }
    return out;
  }
  const { items: bi, ...bf } = b,
    { items: di, ...df } = d,
    { items: si, ...sf } = s;
  const frame = mergeObject(bf, df, sf, [
    ['x', 'y'],
    ['viewportWidth', 'viewportHeight'],
  ]);
  const bm = new Map(bi.map((i) => [i.id, i])),
    dm = new Map(di.map((i) => [i.id, i])),
    sm = new Map(si.map((i) => [i.id, i]));
  const result: GameUiItem[] = [];
  for (const id of new Set([
    ...si.map((i) => i.id),
    ...di.map((i) => i.id),
    ...bi.map((i) => i.id),
  ])) {
    const a = bm.get(id),
      n = dm.get(id),
      v = sm.get(id);
    const eq = restoring ? logical : same;
    if (eq(a, n)) {
      if (v) result.push(v);
      continue;
    }
    if (eq(a, v) || eq(n, v)) {
      if (n)
        result.push(
          restoring
            ? {
                ...n,
                generation: v?.generation ?? globalThis.crypto.randomUUID(),
              }
            : n,
        );
      continue;
    }
    if (
      !a ||
      !n ||
      !v ||
      (!restoring &&
        (a.generation !== n.generation || a.generation !== v.generation))
    )
      fail('UI 삭제·복구와 이후 변경이 충돌했습니다.');
    const { slots: as, ...ar } = a,
      { slots: ns, ...nr } = n,
      { slots: vs, ...vr } = v;
    result.push({
      ...mergeObject(ar, nr, vr, [
        ['x', 'y'],
        ['width', 'height'],
        ['minimum', 'value', 'maximum'],
        ['count', 'columns', 'gap', 'selectedSlot'],
      ]),
      slots: mergeSlots(as, ns, vs),
    });
  }
  return serializeGameUi({ ...frame, items: result });
}
