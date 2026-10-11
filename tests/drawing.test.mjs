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
} from '../src/drawing-model.ts';
import {
  shapeFromDrag,
  strokeGeometry,
  drawingBounds,
  strokeHit,
  strokePath,
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
      JSON.stringify({ version: 2, canvasId: 'default', objects: [] }),
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
