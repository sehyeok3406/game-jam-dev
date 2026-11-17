import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  UserEditRecorder,
  RecordedCommandPublisher,
} from '../src/application/editing/user-edit-recorder.ts';
import { EditJournal } from '../src/edit-journal.ts';
import { COMMAND_LABELS } from '../src/contracts/commands.ts';
import { filesystemProjectRepository } from '../src/adapters/filesystem/local-project-repository.ts';

function setup(save = async () => {}) {
  const journal = new EditJournal(),
    entries = [];
  let ids = 0,
    time = 100;
  const recorder = new UserEditRecorder(
    {
      saveHistory: async (...args) => {
        await save(...args);
        entries.push(args);
      },
    },
    journal,
    { id: () => `edit-${++ids}`, now: () => ++time },
  );
  return { journal, entries, recorder };
}
test('user history skips no-ops and preserves legacy fields, injected clock and undo identity', async () => {
  const { journal, entries, recorder } = setup();
  await recorder.record(
    { 'docs/a.md': 'before' },
    { 'docs/a.md': 'before' },
    'no-op',
  );
  assert.equal(entries.length, 0);
  await recorder.record(
    { 'docs/a.md': 'before' },
    { 'docs/a.md': 'after' },
    '문서 수정',
  );
  assert.deepEqual(entries[0], [
    { 'docs/a.md': 'before' },
    { 'docs/a.md': 'after' },
    {
      id: 'edit-1',
      label: '문서 수정',
      kind: 'user',
      status: 'completed',
      createdAt: 101,
      finishedAt: 102,
    },
  ]);
  assert.deepEqual(journal.state, { undo: '문서 수정', redo: null });
});
test('AI task requests and task-only folds retain history without entering undo, mixed folds remain undoable', async () => {
  const { journal, entries, recorder } = setup();
  await recorder.record({}, { '.ai/tasks/a.md': 'task' }, 'AI 작업 요청');
  await recorder.record(
    { '.ai/tasks/a.md': 'task' },
    { '.ai/tasks/a.md': 'folded' },
    '문서 최소화·펼치기',
  );
  assert.equal(entries.length, 2);
  assert.equal(journal.state.undo, null);
  await recorder.record(
    { '.ai/tasks/a.md': 'task', 'docs/a.md': 'note' },
    { '.ai/tasks/a.md': 'folded', 'docs/a.md': 'folded' },
    '문서 최소화·펼치기',
  );
  assert.equal(journal.state.undo, '문서 최소화·펼치기');
});
test('failed history is not acknowledged, and an async record stays in its captured journal', async () => {
  const failed = setup(async () => {
    throw Error('history unavailable');
  });
  await assert.rejects(
    failed.recorder.record({}, { 'docs/a.md': 'note' }, '수정'),
    /history unavailable/,
  );
  assert.equal(failed.journal.state.undo, null);
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const captured = setup(() => gate),
    next = new EditJournal();
  const record = captured.recorder.record(
    {},
    { 'docs/a.md': 'note' },
    '이전 프로젝트',
  );
  release();
  await record;
  assert.equal(captured.journal.state.undo, '이전 프로젝트');
  assert.equal(next.state.undo, null);
});
test('recent Undo keeps 20 edits in memory and older edits read only their own record', async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-recent-edits-'),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repository = filesystemProjectRepository(root, () => {}, true);
  const journal = new EditJournal();
  let number = 0;
  const recorder = new UserEditRecorder(repository, journal, {
    id: () => `edit-${++number}`,
    now: Date.now,
  });
  for (let i = 1; i <= 21; i++) {
    await recorder.record(
      { 'docs/a.md': String(i - 1), 'docs/unchanged.md': 'unrelated' },
      { 'docs/a.md': String(i), 'docs/unchanged.md': 'unrelated' },
      `Edit ${i}`,
    );
  }
  assert.equal((await repository.history()).length, 21);
  assert.equal(journal.undoStack.length, 21);

  const readdir = fs.readdir;
  t.mock.method(fs, 'readdir', (directory, ...options) => {
    assert.notEqual(path.basename(directory), '.history');
    return readdir(directory, ...options);
  });
  const readFile = fs.readFile;
  const reads = t.mock.method(fs, 'readFile', readFile);

  for (let i = 2; i <= 21; i++) {
    const change = await repository.readEditHistory(`edit-${i}`);
    assert.deepEqual(change.before, { 'docs/a.md': String(i - 1) });
    assert.deepEqual(change.after, { 'docs/a.md': String(i) });
  }
  assert.equal(reads.mock.callCount(), 0);

  const older = await repository.readEditHistory('edit-1');
  assert.deepEqual(older.before, { 'docs/a.md': '0' });
  assert.deepEqual(older.after, { 'docs/a.md': '1' });
  assert.equal(reads.mock.callCount(), 3);
  assert.ok(
    reads.mock.calls.every(({ arguments: [filename] }) =>
      filename.includes(`${path.sep}edit-1${path.sep}`),
    ),
  );
  assert.equal(
    await repository.readHistory('edit-1', 'docs/a.md', 'before'),
    '0',
  );

  const reopened = filesystemProjectRepository(root, () => {}, true);
  assert.deepEqual((await reopened.readEditHistory('edit-21')).after, {
    'docs/a.md': '21',
  });
  assert.equal(reads.mock.callCount(), 8);
});
test('manual commands publish then record once; failed publish/history cannot notify success', async () => {
  const plan = {
    before: { 'docs/a.md': 'a' },
    files: { 'docs/a.md': 'b' },
    changes: { 'docs/a.md': 'b' },
    result: undefined,
  };
  for (const channel of [
    'sections:rename',
    'documents:delete-many',
    'documents:set-color',
    'layouts:update',
  ]) {
    const { journal, entries, recorder } = setup();
    let published = 0,
      changed = 0;
    const publisher = new RecordedCommandPublisher(
      {
        publish: async () => {
          published++;
          assert.equal(entries.length, 0);
        },
      },
      recorder,
      () => {
        changed++;
        assert.equal(entries.length, 1);
      },
    );
    await publisher.publish(channel, plan);
    assert.equal(published, 1);
    assert.equal(entries.length, 1);
    assert.equal(journal.state.undo, COMMAND_LABELS[channel]);
    assert.equal(
      changed,
      ['documents:set-color', 'layouts:update'].includes(channel) ? 1 : 0,
    );
  }
  for (const failure of ['publish', 'history']) {
    const { journal, recorder } = setup(async () => {
      if (failure === 'history') throw Error(failure);
    });
    let changed = false;
    const publisher = new RecordedCommandPublisher(
      {
        publish: async () => {
          if (failure === 'publish') throw Error(failure);
        },
      },
      recorder,
      () => {
        changed = true;
      },
    );
    await assert.rejects(
      publisher.publish('layouts:update', plan),
      new RegExp(failure),
    );
    assert.equal(journal.state.undo, null);
    assert.equal(changed, false);
  }
  const other = setup();
  await new RecordedCommandPublisher(
    { publish: async () => {} },
    other.recorder,
    () => assert.fail('duplicate notification'),
  ).publish('documents:save', plan);
  assert.equal(other.entries.length, 0);
});
