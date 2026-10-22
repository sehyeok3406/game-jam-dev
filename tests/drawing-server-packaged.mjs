import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { CollaborationClient } from '../src/collaboration-client.ts';
import {
  strokeGeometry,
  DEFAULT_PEN_STYLE,
  eraseRegion,
  strokeHit,
} from '../src/drawing-geometry.ts';
import { snapshotDrawings } from '../src/drawing-model.ts';
import { createTextObject } from '../src/text-document.ts';
const runtime = path.resolve(
  'out/Game Jam!-win32-x64/resources/self-host-runtime',
);
const directory = await fs.mkdtemp(
  path.join(os.tmpdir(), 'eraser-server-packaged-'),
);
const reserve = net.createServer();
await new Promise((r) => reserve.listen(0, '127.0.0.1', r));
const port = reserve.address().port;
await new Promise((r) => reserve.close(r));
const url = `http://127.0.0.1:${port}`;
const child = spawn(
  path.join(runtime, 'node.exe'),
  [path.join(runtime, 'server.mjs')],
  {
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      GAME_CANVAS_HOST: '127.0.0.1',
      GAME_CANVAS_PORT: String(port),
      GAME_CANVAS_DATA: directory,
      GAME_CANVAS_PUBLIC: '0',
    },
  },
);
const clients = [];
try {
  let health;
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(url + '/health');
      health = await response.json();
      break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(health?.drawingEraseVersion, 1);
  assert.equal(health?.drawingTextVersion, 1);
  const initial = await CollaborationClient.create(
    url,
    '',
    'owner',
    'eraser runtime',
    {},
  );
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
  const o = {
    id: randomUUID(),
    generation: randomUUID(),
    createdAt: 1,
    updatedAt: 1,
    order: 1,
    layer: 'annotation',
    kind: 'stroke',
    style: { ...DEFAULT_PEN_STYLE, strokeWidth: 30 },
    ...strokeGeometry(
      [
        [100, 100, 0.5],
        [300, 100, 0.5],
      ],
      'pen',
      false,
    ),
  };
  await owner.command('drawings:apply', {
    canvasId: 'default',
    action: 'create',
    objects: [o],
  });
  await peer.refresh();
  const command = (x) => ({
    canvasId: 'default',
    action: 'erase',
    erasures: [
      {
        id: o.id,
        generation: o.generation,
        expectedTransform: o.transform,
        expectedGeometry: o.geometry,
        expectedStrokeWidth: 30,
        region: eraseRegion(o, { x, y: 100 }, { x, y: 100 }, 4, randomUUID()),
      },
    ],
  });
  await owner.command('drawings:apply', command(150));
  const history = owner.lastCommandHistoryId;
  await peer.command('drawings:apply', command(200));
  await owner.refresh();
  assert.equal(snapshotDrawings(owner.files)[0].geometry.erasures.length, 2);
  await owner.changeHistory(history, 'undo');
  const remaining = snapshotDrawings(owner.files)[0];
  assert.equal(remaining.geometry.erasures.length, 1);
  assert.ok(strokeHit(remaining, { x: 150, y: 100 }, { x: 150, y: 100 }, 1));
  assert.equal(
    strokeHit(remaining, { x: 200, y: 100 }, { x: 200, y: 100 }, 1),
    false,
  );
  const text = createTextObject(300, 200);
  text.geometry.document = JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'orderedList',
        attrs: { start: 1 },
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: '번들 서버 번호 목록' }],
              },
            ],
          },
        ],
      },
    ],
  });
  await owner.command('drawings:apply', {
    canvasId: 'default',
    action: 'create',
    objects: [text],
  });
  await peer.refresh();
  assert.equal(
    snapshotDrawings(peer.files).find((o) => o.kind === 'text').geometry
      .document,
    text.geometry.document,
  );
  assert.match(
    await fs.readFile(
      path.join(runtime, 'drawing-third-party-notices.txt'),
      'utf8',
    ),
    /Mike Fogel/,
  );
  await fs.mkdir('out/drawing-packaged', { recursive: true });
  await fs.writeFile(
    'out/drawing-packaged/server-report.json',
    JSON.stringify(
      {
        passed: true,
        bundledNode: true,
        bundledServer: true,
        capability: true,
        twoClients: true,
        independentUndo: true,
        textLists: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: bundled Node/server support text lists, v2 erase, two clients, independent Undo and license notices.',
  );
} finally {
  clients.forEach((c) => c.stop());
  if (child.exitCode === null) {
    child.kill();
    await new Promise((r) => child.once('exit', r));
  }
  assert.ok(directory.startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(directory, { recursive: true, force: true });
}
