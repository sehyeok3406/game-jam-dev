import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from '../src/markdown.ts';
import {
  applyGameUi,
  readGameUi,
  gameUiPath,
  snapshotGameUi,
  newGameUiItem,
  mergeGameUi,
} from '../src/game-ui-model.ts';
import {
  reduceCollaboration,
  checkSnapshot,
} from '../src/collaboration-model.ts';
import { invertEdit } from '../src/edit-journal.ts';
import { planOfflineMerge } from '../src/offline-sync.ts';
import { captureProject, materialize } from '../src/project-store.ts';
import { changeCanvasSheets } from '../src/canvas-sheet-commands.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { validateArtifacts } from '../src/ai-artifacts.ts';
const create = (canvasId = 'default') => ({
  version: 1,
  id: randomUUID(),
  generation: randomUUID(),
  canvasId,
  title: '전투 HUD',
  x: 10,
  y: 20,
  width: 720,
  viewportWidth: 1920,
  viewportHeight: 1080,
  items: [],
  descriptionPath: null,
});
const command = (f, action, rest = {}) => ({
  id: f.id,
  generation: f.generation,
  action,
  ...rest,
});
const init = (f) => applyGameUi({}, command(f, 'create', { frame: f }));
const get = (files, f) => readGameUi(files[gameUiPath(f.id)]);
const patch = (f, i, changes) =>
  command(f, 'patch', {
    patches: [
      {
        id: i.id,
        generation: i.generation,
        changes,
        expected: Object.fromEntries(
          Object.keys(changes).map((k) => [k, i[k]]),
        ),
      },
    ],
  });
test('frame is standalone; description is opt-in and reused; names and user descriptions follow stable IDs', () => {
  const f = create(),
    a = newGameUiItem('health', randomUUID),
    b = newGameUiItem('skills', randomUUID);
  let files = init(f);
  assert.equal(Object.keys(files).length, 1);
  files = applyGameUi(files, command(f, 'add', { items: [a] }));
  assert.equal(get(files, f).descriptionPath, null);
  files = applyGameUi(files, command(f, 'describe'));
  const doc = `docs/ui/${f.id}.md`;
  assert.match(files[doc], /체력.*현재 체력/);
  const parsed = matter(files[doc]);
  files[doc] = matter.stringify(
    parsed.content.replace(
      '현재 체력과 최대 체력을 표시합니다.',
      '피격 때 체력 감소. 직접 작성한 설명!',
    ) + '\n추가 기획 메모\n',
    parsed.data,
  );
  files = applyGameUi(files, patch(f, a, { name: '플레이어 체력' }));
  assert.match(files[doc], /플레이어 체력.*직접 작성/);
  assert.match(files[doc], /추가 기획 메모/);
  files = applyGameUi(files, command(f, 'add', { items: [b] }));
  assert.match(files[doc], /스킬 바/);
  const previous = files[doc];
  files = applyGameUi(files, command(f, 'describe'));
  assert.equal(files[doc], previous);
  files = applyGameUi(
    files,
    command(f, 'remove', { targets: [{ id: a.id, generation: a.generation }] }),
  );
  assert.doesNotMatch(matter(files[doc]).content, /플레이어 체력/);
  assert.match(files[doc], /추가 기획 메모/);
  checkSnapshot(files);
});
test('all templates validate, non-gauge rings and malformed IDs/coordinates/samples/duplicates are rejected atomically', () => {
  const f = create();
  const files = init(f);
  for (const kind of [
    'health',
    'mana',
    'stamina',
    'experience',
    'skills',
    'items',
    'button',
    'panel',
    'text',
    'image',
  ]) {
    const item = newGameUiItem(kind, randomUUID);
    const next = applyGameUi(files, command(f, 'add', { items: [item] }));
    checkSnapshot(next);
    for (const change of [
      { x: NaN },
      { shape: 'url(javascript:1)' },
      { count: 33 },
      { maximum: 0 },
      { value: 101 },
      { groupId: 'bad' },
      ...(['health', 'mana', 'stamina', 'experience'].includes(kind)
        ? []
        : [{ shape: 'ring' }]),
    ]) {
      assert.throws(() => applyGameUi(next, patch(f, item, change)));
      assert.equal(snapshotGameUi(files)[0].items.length, 0);
    }
  }
  const a = newGameUiItem('health', randomUUID),
    b = { ...newGameUiItem('health', randomUUID), name: a.name };
  assert.throws(() => applyGameUi(files, command(f, 'add', { items: [a, b] })));
  assert.throws(() =>
    applyGameUi(
      files,
      command(f, 'frame', { changes: { x: 100 }, expected: { x: 99 } }),
    ),
  );
  assert.throws(() =>
    applyGameUi(
      files,
      command(f, 'frame', {
        changes: { viewportWidth: 8192, viewportHeight: 8192 },
        expected: { viewportWidth: 1920, viewportHeight: 1080 },
      }),
    ),
  );
});
test('slots retain state on shrink/expand; move and resize only touch frame coordinates', () => {
  const f = create(),
    i = newGameUiItem('items', randomUUID);
  i.slots[8].label = '검';
  i.slots[8].quantity = 42;
  let files = applyGameUi(init(f), command(f, 'add', { items: [i] }));
  files = applyGameUi(files, patch(f, i, { count: 3 }));
  const shrunk = get(files, f).items[0];
  files = applyGameUi(files, patch(f, shrunk, { count: 9 }));
  assert.equal(get(files, f).items[0].slots[8].quantity, 42);
  files = applyGameUi(
    files,
    command(f, 'frame', {
      changes: { x: 500, y: 600, width: 900 },
      expected: { x: 10, y: 20, width: 720 },
    }),
  );
  assert.deepEqual(get(files, f).items[0], i);
});
test('property-aware offline merge and Undo preserve another editor; conflicting moves refuse overwrite', () => {
  const f = create(),
    i = newGameUiItem('health', randomUUID),
    base = applyGameUi(init(f), command(f, 'add', { items: [i] }));
  const local = applyGameUi(base, patch(f, i, { x: 100, y: 200 })),
    server = applyGameUi(base, patch(f, i, { text: '다른 팀원 문구' }));
  const merged = planOfflineMerge(base, local, server);
  assert.equal(merged.conflicts.length, 0);
  const item = get(merged.merged, f).items[0];
  assert.equal(item.x, 100);
  assert.equal(item.text, '다른 팀원 문구');
  const undone = invertEdit(merged.merged, base, local, 'undo');
  assert.equal(get(undone, f).items[0].x, i.x);
  assert.equal(get(undone, f).items[0].text, '다른 팀원 문구');
  const rival = applyGameUi(base, patch(f, i, { x: 333, y: 222 }));
  assert.throws(() =>
    mergeGameUi(
      base[gameUiPath(f.id)],
      local[gameUiPath(f.id)],
      rival[gameUiPath(f.id)],
    ),
  );
  assert.throws(() =>
    applyGameUi(local, {
      ...patch(f, i, { text: 'old' }),
      generation: randomUUID(),
    }),
  );
});
test('snapshot, history, canvas deletion and AI original protection include plugin files', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'game-ui-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const f = create(),
    files = init(f);
  await materialize(dir, files);
  assert.deepEqual(await captureProject(dir), files);
  const sheets = {
      version: 1,
      canvases: [
        { id: 'default', name: '기본' },
        { id: 'other', name: '다른' },
      ],
    },
    raw = JSON.stringify(sheets);
  let withDoc = applyGameUi(
    { ...files, '.canvas/canvases.json': raw },
    command(f, 'describe'),
  );
  const moved = changeCanvasSheets(withDoc, {
    action: 'delete',
    id: 'default',
    targetId: 'other',
    expected: raw,
  });
  assert.equal(get(moved, f).canvasId, 'other');
  assert.equal(matter(moved[`docs/ui/${f.id}.md`]).data.canvas_id, 'other');
  checkSnapshot(moved);
  assert.throws(() => validateArtifacts(files, {}, ['docs/out.md']), /그림/);
  const after = reduceCollaboration(
    files,
    'game-ui:apply',
    command(f, 'frame', {
      changes: { title: '새 이름' },
      expected: { title: f.title },
    }),
  ).files;
  assert.equal(get(after, f).title, '새 이름');
});
test('restored elements and frames fence old commands while redo remains conditional; independent slots merge', () => {
  const f = create(),
    i = newGameUiItem('items', randomUUID),
    base = applyGameUi(init(f), command(f, 'add', { items: [i] }));
  const a = structuredClone(i.slots),
    b = structuredClone(i.slots);
  a[0].quantity = 3;
  b[1].quantity = 9;
  const left = applyGameUi(base, patch(f, i, { slots: a }));
  const both = applyGameUi(left, patch(f, i, { slots: b }));
  assert.equal(get(both, f).items[0].slots[0].quantity, 3);
  assert.equal(get(both, f).items[0].slots[1].quantity, 9);
  const removed = applyGameUi(base, command(f, 'remove', { targets: [i] })),
    restored = invertEdit(removed, base, removed, 'undo');
  assert.notEqual(get(restored, f).items[0].generation, i.generation);
  assert.throws(() => applyGameUi(restored, patch(f, i, { text: 'stale' })));
  assert.equal(
    get(invertEdit(restored, base, removed, 'redo'), f).items.length,
    0,
  );
  const deleted = applyGameUi(base, command(f, 'delete')),
    frameRestored = invertEdit(deleted, base, deleted, 'undo');
  assert.notEqual(get(frameRestored, f).generation, f.generation);
  assert.throws(() =>
    applyGameUi(frameRestored, patch(f, i, { text: 'old frame' })),
  );
  assert.equal(
    Object.keys(invertEdit(frameRestored, base, deleted, 'redo')).length,
    0,
  );
});
test('real server supports independent same-widget edits, request retry, descriptions, Undo, and viewer/old-client protection', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'game-ui-server-'));
  const server = await createCollaborationServer({
    port: 0,
    dataDirectory: root,
  });
  t.after(async () => {
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.port}`;
  const initial = await CollaborationClient.create(url, '', 'owner', 'UI QA', {
    'project.md': '# UI QA',
  });
  const owner = new CollaborationClient(initial.credentials, () => {});
  owner.accept(initial.result);
  const joined = await CollaborationClient.join(
    url,
    initial.result.code,
    'editor',
  );
  const editor = new CollaborationClient(joined.credentials, () => {});
  editor.accept(joined.result);
  t.after(() => {
    owner.stop();
    editor.stop();
  });
  const f = create(),
    c = command(f, 'create', { frame: f, requestId: randomUUID() });
  await owner.command('game-ui:apply', c);
  await owner.command('game-ui:apply', c);
  const i = newGameUiItem('health', randomUUID);
  await owner.command('game-ui:apply', command(f, 'add', { items: [i] }));
  await editor.refresh();
  await owner.command('game-ui:apply', patch(f, i, { x: 90, y: 90 }));
  await editor.command('game-ui:apply', patch(f, i, { text: '팀원 변경' }));
  await owner.refresh();
  assert.equal(get(owner.files, f).items[0].x, 90);
  assert.equal(get(owner.files, f).items[0].text, '팀원 변경');
  await owner.command('game-ui:apply', command(f, 'describe'));
  assert.match(owner.files[`docs/ui/${f.id}.md`], /체력/);
  const history = owner.lastCommandHistoryId;
  await owner.changeHistory(history, 'undo');
  assert.equal(get(owner.files, f).descriptionPath, null);
  await owner.setRole(editor.state.memberId, 'viewer');
  await editor.refresh();
  await assert.rejects(
    editor.command(
      'game-ui:apply',
      patch(f, get(editor.files, f).items[0], { text: 'blocked' }),
    ),
    /권한|보기|관리자|뷰어/,
  );
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
        channel: 'game-ui:apply',
        input: patch(f, get(owner.files, f).items[0], { text: 'old client' }),
        drawingsVersion: 1,
        revisions: owner.revisions,
      }),
    },
  );
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /게임 UI.*업데이트/);
});
