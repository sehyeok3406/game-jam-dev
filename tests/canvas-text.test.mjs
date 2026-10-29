import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createTextObject,
  validateTextDocument,
  textDocumentHtml,
  plainTextDocument,
  isEmptyTextDocument,
} from '../src/text-document.ts';
import {
  applyDrawing,
  readDrawingFile,
  serializeDrawing,
  snapshotDrawings,
  drawingPath,
  drawingDelta,
  applyDrawingDelta,
  mergeDrawingFile,
} from '../src/drawing-model.ts';
import { drawingSvg } from '../src/drawing-geometry.ts';
import { assertEraseSupport } from '../src/server/services/drawing-capabilities.ts';
import fs from 'node:fs/promises';
import os from 'node:os';
import nodePath from 'node:path';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
const path = drawingPath('default');
const paragraph = (text) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
const list = (type) => ({
  type,
  ...(type === 'orderedList' ? { attrs: { start: 3, type: null } } : {}),
  content: [
    {
      type: 'listItem',
      content: [
        paragraph('첫 항목'),
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [paragraph('하위 항목')] }],
        },
      ],
    },
    { type: 'listItem', content: [paragraph('둘째 항목')] },
  ],
});
const object = () => {
  const o = createTextObject(120, 140);
  o.geometry.document = JSON.stringify({
    type: 'doc',
    content: [
      paragraph('한글 자유 텍스트'),
      list('bulletList'),
      list('orderedList'),
    ],
  });
  return o;
};
const create = (o) =>
  applyDrawing({}, { canvasId: 'default', action: 'create', objects: [o] });

test('empty detection includes whitespace, line breaks and empty lists; plain paste preserves literal text', () => {
  assert.equal(
    isEmptyTextDocument(createTextObject(0, 0).geometry.document),
    true,
  );
  assert.equal(isEmptyTextDocument(plainTextDocument(' \r\n\t\n')), true);
  assert.equal(
    isEmptyTextDocument(
      JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
          },
        ],
      }),
    ),
    true,
  );
  const raw = plainTextDocument('<script>문자 그대로</script>\r\n\r\n다음 줄');
  assert.equal(isEmptyTextDocument(raw), false);
  assert.equal(JSON.parse(raw).content.length, 3);
  assert.match(textDocumentHtml(raw), /&lt;script&gt;/);
  assert.throws(() => plainTextDocument('x'.repeat(100_001)));
});

test('automatic empty text deletion refuses concurrent content edits and accepts the expected geometry', () => {
  const o = createTextObject(0, 0),
    before = create(o);
  const command = {
    canvasId: 'default',
    action: 'delete',
    targets: [
      { id: o.id, generation: o.generation, expectedGeometry: o.geometry },
    ],
  };
  assert.equal(snapshotDrawings(applyDrawing(before, command)).length, 0);
  const changed = applyDrawing(before, {
    canvasId: 'default',
    action: 'patch',
    patches: [
      {
        id: o.id,
        generation: o.generation,
        expectedGeometry: o.geometry,
        geometry: {
          ...o.geometry,
          document: plainTextDocument('다른 사용자가 작성'),
        },
      },
    ],
  });
  assert.throws(() => applyDrawing(changed, command), /변경/);
  assert.equal(snapshotDrawings(changed).length, 1);
});
test('text and mixed/nested bullet and numbered lists round trip through the drawing store and deltas', () => {
  const o = object(),
    files = create(o);
  assert.equal(JSON.parse(files[path]).version, 3);
  assert.deepEqual(snapshotDrawings(files)[0].geometry, o.geometry);
  const copy = {};
  applyDrawingDelta(copy, path, drawingDelta(path, undefined, files[path]));
  assert.equal(copy[path], files[path]);
  assert.equal(
    serializeDrawing(readDrawingFile(copy[path], 'default')),
    files[path],
  );
});
test('text renderer escapes markup and preserves ordered starts, nested lists and inline marks', () => {
  const o = object();
  const doc = JSON.parse(o.geometry.document);
  doc.content[0].content[0] = {
    type: 'text',
    text: '<script>&한글',
    marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }],
  };
  o.geometry.document = JSON.stringify(doc);
  const html = textDocumentHtml(o.geometry.document);
  assert.match(html, /&lt;script&gt;&amp;한글/);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /start="3"/);
  assert.match(html, /<u><em><strong>/);
  assert.match(drawingSvg(o), /foreignObject.*&lt;script&gt;/);
});
test('text schema rejects arbitrary markup, unknown nodes, attributes, excessive depth and invalid formatting', () => {
  for (const value of [
    '<p>HTML</p>',
    '{}',
    JSON.stringify({
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'x' } }],
    }),
    JSON.stringify({
      type: 'doc',
      content: [{ ...paragraph('x'), attrs: { onclick: 'run()' } }],
    }),
    'x'.repeat(100_001),
  ])
    assert.throws(() => validateTextDocument(value));
  let nested = paragraph('deep');
  for (let i = 0; i < 20; i++)
    nested = {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [paragraph('x'), nested] }],
    };
  assert.throws(() =>
    validateTextDocument(JSON.stringify({ type: 'doc', content: [nested] })),
  );
  const o = object();
  o.geometry.fontSize = 0;
  assert.throws(() => create(o));
});
test('stale text edits are refused and independent position changes merge without losing content', () => {
  const o = object(),
    before = create(o);
  const geometry = {
    ...o.geometry,
    document: JSON.stringify({
      type: 'doc',
      content: [paragraph('수정 내용')],
    }),
  };
  const changed = applyDrawing(before, {
    canvasId: 'default',
    action: 'patch',
    patches: [
      {
        id: o.id,
        generation: o.generation,
        geometry,
        expectedGeometry: o.geometry,
      },
    ],
  });
  assert.throws(
    () =>
      applyDrawing(changed, {
        canvasId: 'default',
        action: 'patch',
        patches: [
          {
            id: o.id,
            generation: o.generation,
            geometry: o.geometry,
            expectedGeometry: o.geometry,
          },
        ],
      }),
    /변경/,
  );
  const moved = applyDrawing(before, {
    canvasId: 'default',
    action: 'patch',
    patches: [{ id: o.id, generation: o.generation, transform: { x: 300 } }],
  });
  const merged = mergeDrawingFile(
    path,
    before[path],
    changed[path],
    moved[path],
  );
  const actual = readDrawingFile(merged, 'default').objects[0];
  assert.equal(actual.transform.x, 300);
  assert.deepEqual(actual.geometry, geometry);
});
test('older clients cannot access or overwrite text projects without the explicit capability', () => {
  const files = create(object());
  assert.throws(
    () => assertEraseSupport(files, { drawingEraseVersion: 1 }),
    /텍스트.*업데이트/,
  );
  assert.doesNotThrow(() =>
    assertEraseSupport(files, {
      drawingEraseVersion: 1,
      drawingTextVersion: 1,
    }),
  );
});

test('two real clients share lists, reject stale edits, undo content and reopen persisted text', async (t) => {
  const directory = await fs.mkdtemp(
    nodePath.join(os.tmpdir(), 'gamejam-text-server-'),
  );
  let server = await createCollaborationServer({
    dataDirectory: directory,
    port: 0,
  });
  const clients = [];
  t.after(async () => {
    clients.forEach((c) => c.stop());
    await server.close();
    assert.equal(nodePath.dirname(directory), nodePath.resolve(os.tmpdir()));
    assert.ok(nodePath.basename(directory).startsWith('gamejam-text-server-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.port}`;
  const initial = await CollaborationClient.create(
    url,
    '',
    'owner',
    'text project',
    {},
  );
  const owner = new CollaborationClient(initial.credentials, () => {});
  owner.accept(initial.result);
  clients.push(owner);
  const joined = await CollaborationClient.join(
    url,
    initial.result.code,
    'editor',
  );
  const peer = new CollaborationClient(joined.credentials, () => {});
  peer.accept(joined.result);
  clients.push(peer);
  assert.equal(owner.state.drawingTextVersion, 1);
  assert.equal(owner.state.drawingTextAlignmentVersion, 1);
  const o = object();
  await owner.command('drawings:apply', {
    canvasId: 'default',
    action: 'create',
    objects: [o],
  });
  await peer.refresh();
  assert.equal(
    snapshotDrawings(peer.files)[0].geometry.document,
    o.geometry.document,
  );
  const aligned = JSON.parse(o.geometry.document);
  aligned.content[1].content[0].content[0].attrs = { textAlign: 'center' };
  aligned.content[2].content[1].content[0].attrs = { textAlign: 'right' };
  const geometry = {
    ...o.geometry,
    color: '#ff0000',
    document: JSON.stringify(aligned),
  };
  await peer.command('drawings:apply', {
    canvasId: 'default',
    action: 'patch',
    patches: [
      {
        id: o.id,
        generation: o.generation,
        geometry,
        expectedGeometry: o.geometry,
      },
    ],
  });
  const history = peer.lastCommandHistoryId;
  await assert.rejects(
    owner.command('drawings:apply', {
      canvasId: 'default',
      action: 'patch',
      patches: [
        {
          id: o.id,
          generation: o.generation,
          geometry: { ...o.geometry, fontSize: 30 },
          expectedGeometry: o.geometry,
        },
      ],
    }),
    /변경|충돌/,
  );
  await peer.changeHistory(history, 'undo');
  assert.equal(
    snapshotDrawings(peer.files)[0].geometry.color,
    o.geometry.color,
  );
  await peer.changeHistory(history, 'redo');
  const old = await fetch(
    `${url}/projects/${initial.credentials.projectId}/state`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${initial.credentials.token}`,
      },
      body: JSON.stringify({ drawingEraseVersion: 1, drawingsVersion: 1 }),
    },
  );
  assert.equal(old.status, 409);
  assert.match((await old.json()).error, /텍스트.*업데이트/);
  const legacyTextClient = await fetch(
    `${url}/projects/${initial.credentials.projectId}/state`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${initial.credentials.token}`,
      },
      body: JSON.stringify({
        drawingEraseVersion: 1,
        drawingsVersion: 1,
        drawingTextVersion: 1,
      }),
    },
  );
  assert.equal(legacyTextClient.status, 409);
  assert.match((await legacyTextClient.json()).error, /줄별 정렬.*업데이트/);
  peer.state.drawingTextAlignmentVersion = undefined;
  await assert.rejects(
    peer.command('drawings:apply', {
      canvasId: 'default',
      action: 'patch',
      patches: [{ id: o.id, generation: o.generation, geometry }],
    }),
    /줄별.*서버.*업데이트/,
  );
  const port = server.port;
  clients.forEach((c) => c.stop());
  await server.close();
  server = await createCollaborationServer({ dataDirectory: directory, port });
  const reopened = new CollaborationClient(initial.credentials, () => {});
  clients.push(reopened);
  await reopened.refresh();
  assert.deepEqual(snapshotDrawings(reopened.files)[0].geometry, geometry);
});
