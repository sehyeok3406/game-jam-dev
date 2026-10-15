import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  applyDrawing,
  drawingPath,
  readDrawingFile,
  serializeDrawing,
  snapshotDrawings,
  drawingDelta,
  applyDrawingDelta,
  mergeDrawingFile,
  validateErasure,
} from '../src/drawing-model.ts';
import {
  shapeFromDrag,
  strokeGeometry,
  drawingBounds,
  strokeHit,
  strokePath,
  drawingSvg,
  eraseRegion,
  rotatePoint,
  DEFAULT_SHAPE_STYLE,
  DEFAULT_PEN_STYLE,
} from '../src/drawing-geometry.ts';
import { SHAPE_NAMES } from '../src/drawing-types.ts';
import {
  reduceCollaboration,
  checkSnapshot,
} from '../src/collaboration-model.ts';
import { CANVAS_SHEETS_PATH } from '../src/canvas-sheets.ts';
import { invertEdit } from '../src/edit-journal.ts';
import { planOfflineMerge } from '../src/offline-sync.ts';
import { captureProject, materialize } from '../src/project-store.ts';
import { projectForWeb } from '../src/web-viewer.ts';
import { validateArtifacts } from '../src/ai-artifacts.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';

const file = drawingPath('default');
const object = (shape = 'rectangle') => ({
  id: randomUUID(),
  generation: randomUUID(),
  kind: 'shape',
  ...shapeFromDrag(shape, { x: 100, y: 120 }, { x: 300, y: 260 }),
  style: {
    ...DEFAULT_SHAPE_STYLE,
    ...(['line', 'arrow'].includes(shape) ? { fill: null } : {}),
  },
  layer: 'background',
  order: 1,
  createdAt: 1,
  updatedAt: 1,
});
const stroke = () => ({
  ...object(),
  kind: 'stroke',
  ...strokeGeometry(
    [
      [100, 100, 0.5],
      [200, 100, 0.8],
      [300, 200, 0.5],
    ],
    'pen',
    true,
  ),
  style: { ...DEFAULT_PEN_STYLE },
  layer: 'annotation',
});
const create = (files, objects, canvasId = 'default') =>
  applyDrawing(files, { canvasId, action: 'create', objects });
const patch = (files, o, p, canvasId = 'default') =>
  applyDrawing(files, {
    canvasId,
    action: 'patch',
    patches: [{ id: o.id, generation: o.generation, ...p }],
  });
const get = (files, id) => snapshotDrawings(files).find((o) => o.id === id);
const md =
  '---\nid: a\ntitle: 메모\ntype: idea\nx: 0\ny: 0\nwidth: 340\nheight: 300\n---\n원본 본문\n';

test('all seven shapes and pressure strokes round-trip; malformed/untrusted geometry fails without touching originals', () => {
  const objects = [...Object.keys(SHAPE_NAMES).map(object), stroke()];
  const files = create({}, objects);
  assert.equal(snapshotDrawings(files).length, 8);
  for (const mutation of [
    (o) => {
      o.style.fill = 'url(javascript:alert(1))';
    },
    (o) => {
      o.transform.rotation = NaN;
    },
    (o) => {
      o.transform.width = 0;
    },
    (o) => {
      o.geometry.extra = '<script>';
    },
    (o) => {
      o.id = '../outside';
    },
    (o) => {
      o.generation = 'stale';
    },
  ]) {
    const bad = structuredClone(objects[0]);
    mutation(bad);
    assert.throws(() => create({}, [bad]));
  }
  assert.throws(() => drawingPath('../outside'));
  assert.throws(() => readDrawingFile('{', 'default'), /JSON/);
  assert.throws(() =>
    readDrawingFile(
      JSON.stringify({ version: 3, canvasId: 'default', objects: [] }),
      'default',
    ),
  );
  const long = stroke();
  long.geometry.points = Array.from({ length: 5001 }, () => [1, 1, 0.5]);
  assert.throws(() => create({}, [long]));
  assert.throws(() => create(files, [objects[0]]), /이미/);
  assert.equal(
    files[file],
    serializeDrawing({ version: 1, canvasId: 'default', objects }),
  );
});

test('Shift/Alt constraints, reversed arrows, rotated bounds and swept erasure retain logical geometry', () => {
  const square = shapeFromDrag(
    'rectangle',
    { x: 100, y: 100 },
    { x: 80, y: 130 },
    true,
    true,
  );
  assert.deepEqual(square.transform, {
    x: 70,
    y: 70,
    width: 60,
    height: 60,
    rotation: 0,
  });
  const arrow = shapeFromDrag('arrow', { x: 300, y: 100 }, { x: 100, y: 100 });
  assert.deepEqual(arrow.geometry.endpoints, [
    [1, 0],
    [0, 0],
  ]);
  const o = object();
  o.transform.rotation = 90;
  const bounds = drawingBounds(o);
  assert.equal(Math.round(bounds.width), 160);
  assert.equal(Math.round(bounds.height), 220);
  const s = stroke();
  assert.ok(strokePath(s).startsWith('M '));
  assert.ok(strokeHit(s, { x: 150, y: 0 }, { x: 150, y: 300 }, 1));
  assert.equal(strokeHit(s, { x: 0, y: 500 }, { x: 500, y: 500 }, 1), false);
  const before = structuredClone(s.geometry);
  s.transform.width *= 2;
  strokePath(s);
  assert.deepEqual(s.geometry, before);
});

test('object/group undo preserves teammate objects and independent style; redo and stale generations work after restore', () => {
  const a = object(),
    b = object('ellipse'),
    base = create({}, [a]);
  const moved = patch(base, a, { transform: { x: 500 } });
  const teammate = patch(create(moved, [b]), a, {
    style: { stroke: '#ff0000' },
  });
  const undone = invertEdit(teammate, base, moved, 'undo');
  assert.equal(get(undone, a.id).transform.x, 100);
  assert.equal(get(undone, a.id).style.stroke, '#ff0000');
  assert.ok(get(undone, b.id));
  const redone = invertEdit(undone, base, moved, 'redo');
  assert.equal(get(redone, a.id).transform.x, 500);
  assert.throws(
    () =>
      invertEdit(
        patch(moved, a, { transform: { x: 700 } }),
        base,
        moved,
        'undo',
      ),
    /충돌/,
  );
  const deleted = applyDrawing(base, {
    canvasId: 'default',
    action: 'delete',
    targets: [a],
  });
  const restored = invertEdit(deleted, base, deleted, 'undo');
  assert.notEqual(get(restored, a.id).generation, a.generation);
  assert.throws(
    () => patch(restored, a, { style: { opacity: 0.5 } }),
    /삭제|이동/,
  );
  assert.equal(
    snapshotDrawings(invertEdit(restored, base, deleted, 'redo')).length,
    0,
  );
  const creationUndo = invertEdit(create({}, [a, b]), {}, base, 'undo');
  assert.ok(get(creationUndo, b.id));
  assert.equal(get(creationUndo, a.id), undefined);
});

test('offline conflict alternatives preserve every independent object and group on either choice', () => {
  const a = object(),
    b = object('triangle'),
    c = object('ellipse');
  const base = create({}, [a]);
  const local = patch(create(base, [b]), a, {
    transform: { x: 300 },
    style: { fill: '#00ff00' },
  });
  const server = patch(create(base, [c]), a, { transform: { x: 600 } });
  const plan = planOfflineMerge(base, local, server);
  assert.equal(plan.conflicts.length, 1);
  for (const choice of ['local', 'server']) {
    const files = {
      ...plan.merged,
      ...Object.fromEntries(
        plan.conflicts[0][choice].map((f) => [f.path, f.content]),
      ),
    };
    assert.ok(get(files, b.id));
    assert.ok(get(files, c.id));
    assert.equal(get(files, a.id).style.fill, '#00ff00');
    assert.equal(get(files, a.id).transform.x, choice === 'local' ? 300 : 600);
    checkSnapshot(files);
  }
});

test('mixed operations and canvas deletion are atomic, survive disk capture and undo/redo', async (t) => {
  const a = object();
  const base = create({ 'ideas/a.md': md }, [a]);
  const input = {
    scope: 'test',
    commands: [
      {
        channel: 'layouts:update',
        input: {
          updates: [
            {
              kind: 'document',
              relativePath: 'ideas/a.md',
              x: 900,
              y: 800,
              width: 340,
              height: 300,
              size: false,
            },
          ],
        },
      },
      {
        channel: 'drawings:apply',
        input: {
          canvasId: 'default',
          action: 'patch',
          patches: [
            { id: a.id, generation: a.generation, transform: { x: 900 } },
          ],
        },
      },
    ],
  };
  const changed = reduceCollaboration(base, 'canvas:batch', input).files;
  assert.match(changed['ideas/a.md'], /x: 900/);
  assert.equal(get(changed, a.id).transform.x, 900);
  assert.deepEqual(
    invertEdit(changed, base, changed, 'undo')['ideas/a.md'],
    base['ideas/a.md'],
  );
  const bad = structuredClone(input);
  bad.commands[1].input.patches[0].generation = randomUUID();
  assert.throws(() => reduceCollaboration(base, 'canvas:batch', bad));
  assert.equal(get(base, a.id).transform.x, 100);
  let tabs = reduceCollaboration(base, 'canvases:change', {
    action: 'add',
    id: 'combat',
    name: '전투',
    expected: null,
  }).files;
  tabs = applyDrawing(tabs, {
    canvasId: 'default',
    action: 'move',
    targetCanvasId: 'combat',
    targets: [a],
  });
  const deleted = reduceCollaboration(tabs, 'canvases:change', {
    action: 'delete',
    id: 'combat',
    targetId: 'default',
    expected: tabs[CANVAS_SHEETS_PATH],
  }).files;
  assert.equal(deleted[drawingPath('combat')], undefined);
  assert.equal(get(deleted, a.id).canvasId, 'default');
  const undone = invertEdit(deleted, tabs, deleted, 'undo');
  checkSnapshot(undone);
  assert.equal(get(undone, a.id).canvasId, 'combat');
  const redone = invertEdit(undone, tabs, deleted, 'redo');
  checkSnapshot(redone);
  assert.equal(redone[drawingPath('combat')], undefined);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'drawings-store-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await materialize(directory, redone);
  assert.deepEqual(await captureProject(directory), redone);
});

test('object deltas omit untouched points; web uses safe SVG and AI cannot modify drawings', () => {
  const a = object(),
    s = stroke(),
    base = create({}, [a, s]),
    changed = patch(base, a, { style: { opacity: 0.5 } });
  const delta = drawingDelta(file, base[file], changed[file]);
  assert.equal(delta.upsert.length, 1);
  assert.equal(delta.upsert[0].id, a.id);
  const reconstructed = { ...base };
  applyDrawingDelta(reconstructed, file, delta);
  assert.equal(reconstructed[file], changed[file]);
  const published = projectForWeb({
    files: changed,
    libraryId: 'local:test',
    name: 'test',
    source: 'published',
  });
  assert.equal(published.readOnly, true);
  assert.equal(published.documents.length, 2);
  const svg = Buffer.from(
    published.documents[0].image.split(',')[1],
    'base64',
  ).toString();
  assert.match(svg, /<svg/);
  assert.doesNotMatch(svg, /<script|javascript:|foreignObject/);
  base['ideas/a.md'] = md;
  changed['ideas/a.md'] = md;
  const output = 'docs/result.md';
  const content = md
    .replace('id: a', 'id: result')
    .replace('원본 본문', 'AI 결과')
    .replace('type: idea', 'type: system\nstatus: draft\nsources: [a]');
  assert.doesNotThrow(() =>
    validateArtifacts(base, { ...base, [output]: content }, [output]),
  );
  assert.throws(
    () => validateArtifacts(base, { ...changed, [output]: content }, [output]),
    /그림/,
  );
});

test('server accepts independent stale-client edits, idempotent retry, viewer/old-client protection and compact deltas', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'drawings-server-'),
  );
  const server = await createCollaborationServer({
    dataDirectory: directory,
    port: 0,
  });
  const clients = [];
  t.after(async () => {
    clients.forEach((c) => c.stop());
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.port}`;
  const initial = await CollaborationClient.create(
    url,
    '',
    '관리자',
    '그림 검증',
    { 'ideas/a.md': md },
  );
  const owner = new CollaborationClient(initial.credentials, () => {});
  owner.accept(initial.result);
  clients.push(owner);
  const joined = await CollaborationClient.join(
    url,
    initial.result.code,
    '팀원',
  );
  const editor = new CollaborationClient(joined.credentials, () => {});
  editor.accept(joined.result);
  clients.push(editor);
  const a = object(),
    b = stroke(),
    id = randomUUID();
  const command = {
    canvasId: 'default',
    action: 'create',
    objects: [a],
    requestId: id,
  };
  await owner.command('drawings:apply', command);
  await owner.command('drawings:apply', command);
  assert.equal(snapshotDrawings(owner.files).length, 1);
  await editor.command('drawings:apply', {
    canvasId: 'default',
    action: 'create',
    objects: [b],
  });
  await owner.command('drawings:apply', {
    canvasId: 'default',
    action: 'patch',
    patches: [
      { id: a.id, generation: a.generation, style: { fill: '#ff0000' } },
    ],
  });
  await editor.refresh();
  assert.equal(snapshotDrawings(editor.files).length, 2);
  assert.equal(get(editor.files, a.id).style.fill, '#ff0000');
  const acknowledgement = await editor.request('state', {
    knownRevision: editor.state.revision - 1,
    deltaVersion: 1,
  });
  assert.ok(acknowledgement.delta.drawings[file]);
  assert.equal(acknowledgement.delta.changes[file], undefined);
  const history = owner.lastCommandHistoryId;
  await owner.changeHistory(history, 'undo');
  assert.ok(get(owner.files, b.id));
  // An older authenticated client must not be able to erase a drawing file through offline/snapshot mutation.
  const response = await fetch(
    `${url}/projects/${owner.credentials.projectId}/command`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${owner.credentials.token}`,
      },
      body: JSON.stringify({
        id: randomUUID(),
        channel: 'documents:save',
        input: { relativePath: 'ideas/a.md', title: 'old', body: 'old' },
        revisions: owner.revisions,
      }),
    },
  );
  assert.equal(response.ok, false);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /그림.*업데이트/);
  await owner.setRole(editor.state.memberId, 'viewer');
  await editor.refresh();
  await assert.rejects(
    editor.command('drawings:apply', {
      canvasId: 'default',
      action: 'create',
      objects: [object()],
    }),
    /권한|보기|관리자|뷰어/,
  );
});

const erase = (files, o, a, b, radius = 8, id = randomUUID()) =>
  applyDrawing(files, {
    action: 'erase',
    canvasId: 'default',
    erasures: [
      {
        id: o.id,
        generation: o.generation,
        expectedTransform: o.transform,
        expectedGeometry: o.geometry,
        expectedStrokeWidth: o.style.strokeWidth,
        region: eraseRegion(o, a, b, radius, id),
      },
    ],
  });
test('partial eraser removes actual ink, preserves identity/pressure and holes through SVG, transforms and round trip', () => {
  const o = stroke();
  o.style.strokeWidth = 40;
  const source = create({}, [o]);
  const a = { x: 160, y: 100 };
  assert.ok(strokeHit(o, a, a, 3));
  const next = erase(source, o, a, a, 5),
    cut = get(next, o.id);
  assert.equal(cut.id, o.id);
  assert.equal(cut.generation, o.generation);
  assert.deepEqual(cut.geometry.points, o.geometry.points);
  assert.equal(JSON.parse(next[file]).version, 2);
  assert.equal(strokeHit(cut, a, a, 1), false, 'hole is not ink');
  assert.ok(
    strokeHit(cut, { x: 160, y: 112 }, { x: 160, y: 112 }, 1),
    'ink beside the hole remains',
  );
  assert.ok(strokePath(cut).includes('Z M'), 'hole has its own ring');
  assert.deepEqual(
    readDrawingFile(
      serializeDrawing(readDrawingFile(next[file], 'default')),
      'default',
    ).objects[0].geometry,
    cut.geometry,
  );
  assert.ok(
    projectForWeb({
      files: next,
      libraryId: 'erase-test',
      name: 'test',
      source: 'published',
    }).documents.some((d) => d.image),
  );
  const moved = {
    ...cut,
    transform: {
      ...cut.transform,
      x: 400,
      y: 300,
      width: 400,
      height: 150,
      rotation: 45,
    },
  };
  const center = { x: 600, y: 375 };
  const hole = rotatePoint({ x: 520, y: 300 }, 45, center);
  assert.equal(strokeHit(moved, hole, hole, 0.2), false);
  const restored = invertEdit(next, source, next, 'undo');
  assert.ok(strokeHit(get(restored, o.id), a, a, 1));
  assert.equal(
    source[file],
    create({}, [o])[file],
    'original snapshot unchanged',
  );
});
test('partial eraser sweeps, full deletion, stale geometry and quota failures are atomic', () => {
  const o = stroke(),
    source = create({}, [o]);
  const next = erase(source, o, { x: 200, y: 0 }, { x: 200, y: 400 }, 8);
  assert.equal(
    strokeHit(get(next, o.id), { x: 200, y: 90 }, { x: 200, y: 110 }, 1),
    false,
  );
  const full = erase(source, o, { x: 0, y: 0 }, { x: 400, y: 400 }, 400);
  assert.equal(snapshotDrawings(full).length, 0);
  assert.equal(JSON.parse(full[file]).version, 2);
  assert.equal(
    snapshotDrawings(invertEdit(full, source, full, 'undo')).length,
    1,
  );
  const moved = patch(source, o, { transform: { x: 120 } });
  assert.throws(
    () => erase(moved, o, { x: 150, y: 100 }, { x: 150, y: 110 }),
    /변경/,
  );
  const bad = eraseRegion(
    o,
    { x: 150, y: 100 },
    { x: 150, y: 110 },
    8,
    randomUUID(),
  );
  bad.polygons[0][0][0][0] = NaN;
  assert.throws(() =>
    applyDrawing(source, {
      canvasId: 'default',
      action: 'erase',
      erasures: [
        {
          id: o.id,
          generation: o.generation,
          expectedTransform: o.transform,
          expectedGeometry: o.geometry,
          expectedStrokeWidth: o.style.strokeWidth,
          region: bad,
        },
      ],
    }),
  );
  assert.equal(snapshotDrawings(source).length, 1);
});
test('two erasers on one stroke merge by region ID, preserve peer style and undo only the local region', () => {
  const o = stroke();
  o.style.strokeWidth = 30;
  const source = create({}, [o]),
    p = { x: 150, y: 100 },
    q = { x: 180, y: 100 };
  const local = erase(source, o, p, p, 4),
    peer = erase(source, o, q, q, 4);
  const merged = mergeDrawingFile(file, source[file], local[file], peer[file]);
  assert.equal(get({ [file]: merged }, o.id).geometry.erasures.length, 2);
  const styled = patch({ [file]: merged }, get({ [file]: merged }, o.id), {
    style: { stroke: '#ff0000' },
  });
  const undo = mergeDrawingFile(
    file,
    local[file],
    source[file],
    styled[file],
    true,
  );
  const remaining = get({ [file]: undo }, o.id);
  assert.equal(remaining.geometry.erasures.length, 1);
  assert.equal(remaining.style.stroke, '#ff0000');
  assert.ok(strokeHit(remaining, p, p, 1));
  assert.equal(strokeHit(remaining, q, q, 1), false);
  const redo = mergeDrawingFile(file, source[file], local[file], undo, true);
  assert.equal(get({ [file]: redo }, o.id).geometry.erasures.length, 2);
});

test('two real clients erase the same stroke, undo independently, reject old clients and retain v2 deltas', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-eraser-'));
  const server = await createCollaborationServer({
    dataDirectory: directory,
    port: 0,
    host: '127.0.0.1',
  });
  const clients = [];
  t.after(async () => {
    clients.forEach((c) => c.stop());
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.port}`;
  const initial = await CollaborationClient.create(url, '', 'owner', 'erase', {
    'ideas/a.md': md,
  });
  const owner = new CollaborationClient(initial.credentials, () => {});
  owner.accept(initial.result);
  clients.push(owner);
  const joined = await CollaborationClient.join(
    url,
    initial.result.code,
    'peer',
  );
  const peer = new CollaborationClient(joined.credentials, () => {});
  peer.accept(joined.result);
  clients.push(peer);
  assert.equal(owner.state.drawingEraseVersion, 1);
  const o = stroke();
  o.style.strokeWidth = 30;
  await owner.command('drawings:apply', {
    canvasId: 'default',
    action: 'create',
    objects: [o],
  });
  await peer.refresh();
  const command = (x) => ({
    canvasId: 'default',
    action: 'erase',
    requestId: randomUUID(),
    erasures: [
      {
        id: o.id,
        generation: o.generation,
        expectedTransform: o.transform,
        expectedGeometry: o.geometry,
        expectedStrokeWidth: o.style.strokeWidth,
        region: eraseRegion(o, { x, y: 100 }, { x, y: 100 }, 4, randomUUID()),
      },
    ],
  });
  const own = command(150),
    other = command(180);
  await owner.command('drawings:apply', own);
  const history = owner.lastCommandHistoryId;
  await peer.command('drawings:apply', other);
  await owner.refresh();
  assert.equal(get(owner.files, o.id).geometry.erasures.length, 2);
  await owner.changeHistory(history, 'undo');
  assert.equal(get(owner.files, o.id).geometry.erasures.length, 1);
  assert.equal(
    strokeHit(
      get(owner.files, o.id),
      { x: 150, y: 100 },
      { x: 150, y: 100 },
      1,
    ),
    true,
  );
  assert.equal(
    strokeHit(
      get(owner.files, o.id),
      { x: 180, y: 100 },
      { x: 180, y: 100 },
      1,
    ),
    false,
  );
  const older = await fetch(
    `${url}/projects/${owner.credentials.projectId}/state`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${owner.credentials.token}`,
      },
      body: JSON.stringify({ drawingsVersion: 1 }),
    },
  );
  assert.equal(older.status, 409);
  assert.match((await older.json()).error, /부분 지우기.*업데이트/);
  const joinOld = await fetch(`${url}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: initial.result.code, nickname: 'old' }),
  });
  assert.equal(joinOld.status, 409);
  await owner.changeHistory(history, 'redo');
  await peer.refresh();
  assert.equal(get(peer.files, o.id).geometry.erasures.length, 2);
  const ack = await peer.request('state', {
    knownRevision: peer.state.revision - 1,
    deltaVersion: 1,
  });
  assert.equal(ack.delta.drawings[file].version, 2);
  const count = Object.keys(peer.files).length;
  await assert.rejects(
    CollaborationClient.fetch(
      url,
      `/projects/${owner.credentials.projectId}/offline-sync`,
      {
        id: randomUUID(),
        drawingsVersion: 1,
        changes: { [file]: null },
        revisions: owner.revisions,
      },
      owner.credentials.token,
    ),
    /업데이트/,
  );
  await peer.refresh();
  assert.equal(Object.keys(peer.files).length, count);
});

test('point strokes, self crossings, highlighter holes and erasure limits retain safe numeric SVG', () => {
  for (const points of [
    [[100, 100, 0.5]],
    [
      [100, 100, 0.3],
      [200, 200, 0.9],
      [100, 200, 0.5],
      [200, 100, 0.8],
    ],
  ]) {
    const o = {
      ...stroke(),
      ...strokeGeometry(points, 'highlighter', false),
      style: { ...DEFAULT_PEN_STYLE, strokeWidth: 80, opacity: 0.3 },
    };
    const source = create({}, [o]);
    const cut = erase(source, o, { x: 110, y: 110 }, { x: 110, y: 110 }, 4);
    const saved = get(cut, o.id);
    assert.ok(saved);
    assert.equal(saved.style.opacity, 0.3);
    const svg = drawingSvg(saved);
    assert.equal(
      (svg.match(/<path /g) ?? []).length,
      1,
      'all fragments share one path and opacity',
    );
    assert.match(svg, /fill-rule="evenodd"/);
    assert.doesNotMatch(svg, /NaN|Infinity/);
  }
  const bad = {
    id: randomUUID(),
    polygons: [[Array.from({ length: 2001 }, () => [0, 0])]],
  };
  assert.throws(() => validateErasure(bad), /한도/);
  assert.throws(() =>
    validateErasure({
      id: randomUUID(),
      polygons: [
        [
          [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
          ],
        ],
      ],
    }),
  );
});
