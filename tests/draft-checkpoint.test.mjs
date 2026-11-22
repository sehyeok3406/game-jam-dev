import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { DraftCheckpoint } from '../src/ui/editor/draft-checkpoint.ts';
import { EditorDraftStore } from '../src/editor-drafts.ts';

function setup(t, write) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1 });
  const writes = [];
  const errors = [];
  let latest = null;
  let sequence = 0;
  const checkpoint = new DraftCheckpoint(
    async (draft, revision) => {
      await write?.(draft);
      writes.push([draft?.body ?? null, revision]);
    },
    (error) => errors.push(error.message),
  );
  const read = () => latest;
  t.after(() => checkpoint.cancelTimer());
  return {
    checkpoint,
    writes,
    errors,
    read,
    change(body) {
      latest =
        body === null
          ? null
          : { title: 'recovery', body, sequence: ++sequence };
      checkpoint.schedule(read);
    },
    async tick(milliseconds) {
      t.mock.timers.tick(milliseconds);
      await setImmediate();
    },
  };
}

test('continuous changes are sampled at 30 seconds and unchanged contents are skipped', async (t) => {
  const f = setup(t);
  f.change('start');
  await f.tick(20_000);
  f.change('latest at first checkpoint');
  await f.tick(9_999);
  assert.deepEqual(f.writes, []);
  await f.tick(1);
  assert.deepEqual(f.writes, [['latest at first checkpoint', 2]]);
  await f.tick(1_000);
  f.change('latest at first checkpoint');
  await f.tick(29_000);
  assert.equal(f.writes.length, 1);
  await f.tick(5_000);
  f.change('new change');
  await f.tick(25_000);
  assert.deepEqual(f.writes, [
    ['latest at first checkpoint', 2],
    ['new change', 4],
  ]);
  await f.tick(30_000);
  assert.equal(f.writes.length, 2);
});

test('input arriving while a write is in progress stays pending for the next checkpoint', async (t) => {
  const first = Promise.withResolvers();
  const started = [];
  const f = setup(t, async (draft) => {
    started.push(draft.body);
    if (draft.body === 'in flight') await first.promise;
  });
  f.change('in flight');
  await f.tick(30_000);
  assert.deepEqual(started, ['in flight']);
  f.change('newer');
  await f.tick(30_000);
  assert.deepEqual(started, ['in flight']);
  first.resolve();
  await setImmediate();
  assert.deepEqual(f.writes, [
    ['in flight', 1],
    ['newer', 2],
  ]);
});

test('a failed replacement retains the preceding checkpoint and retries the latest change', async (t) => {
  let disk;
  const f = setup(t, async (draft) => {
    if (draft.body === 'failed') throw Error('write failed');
    disk = draft;
  });
  f.change('durable');
  await f.tick(30_000);
  f.change('failed');
  await f.tick(30_000);
  assert.equal(disk.body, 'durable');
  assert.deepEqual(f.errors, ['write failed']);
  f.change('retried');
  await f.tick(30_000);
  assert.equal(disk.body, 'retried');
  await f.checkpoint.clear(2);
  assert.equal(disk.body, 'retried');
});

test('finishing a gesture prunes the recorded command without writing newer input early', async (t) => {
  const f = setup(t);
  f.change('recorded gesture');
  await f.tick(30_000);
  f.change('current gesture');
  await f.checkpoint.reviseSaved((saved) => {
    assert.equal(saved.body, 'recorded gesture');
    return { draft: null, sequence: saved.sequence };
  });
  assert.deepEqual(f.writes, [
    ['recorded gesture', 1],
    [null, 1],
  ]);
  await f.tick(30_000);
  assert.deepEqual(f.writes.at(-1), ['current gesture', 2]);
});

test('ending a session invalidates a queued timer and a discarded legacy draft stays cleared', async (t) => {
  const blocked = Promise.withResolvers();
  const f = setup(t, () => blocked.promise);
  f.checkpoint.remember({ title: 'legacy', body: 'old', sequence: 0 });
  f.change('old session input');
  const discard = f.checkpoint.clear(1);
  await f.tick(30_000);
  f.checkpoint.cancelTimer();
  blocked.resolve();
  await discard;
  await f.tick(30_000);
  assert.deepEqual(f.writes, [[null, 1]]);
});

test('a failed atomic replace keeps the previous recovery file readable on disk', async (t) => {
  const temp = path.resolve(os.tmpdir());
  const directory = await fs.mkdtemp(
    path.join(temp, 'gamejam-draft-checkpoint-'),
  );
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), temp);
    await fs.rm(directory, { recursive: true, force: true });
  });
  const store = new EditorDraftStore(directory);
  const old = { title: 'legacy', body: 'old', sequence: 1 };
  await store.set('draft', old, old.sequence);
  const rename = t.mock.method(fs, 'rename', async () => {
    throw Error('simulated atomic replace failure');
  });
  const write = store.set('draft', { ...old, body: 'new', sequence: 2 }, 2);
  const read = store.get('draft');
  await assert.rejects(write, /simulated atomic replace failure/);
  assert.deepEqual(await read, { ...old, key: 'draft' });
  assert.equal((await fs.readdir(directory)).length, 1);
  rename.mock.restore();
  await store.set('draft', null, 2);
  await store.flush();
  assert.equal(await new EditorDraftStore(directory).get('draft'), null);
});
