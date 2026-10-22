import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  UserEditRecorder,
  RecordedCommandPublisher,
} from '../src/application/editing/user-edit-recorder.ts';
import { EditJournal } from '../src/edit-journal.ts';
import { COMMAND_LABELS } from '../src/contracts/commands.ts';

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
