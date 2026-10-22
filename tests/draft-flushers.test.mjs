import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DraftFlusherRegistry } from '../src/ui/editor/draft-flushers.ts';

test('draft flushing belongs to its own workspace and old cleanup cannot remove a new editor', async () => {
  const first = new DraftFlusherRegistry(),
    second = new DraftFlusherRegistry();
  const calls = [];
  const oldCleanup = first.register('unchanged-draft-key', async () => {
    calls.push('old');
  });
  const cleanup = first.register('unchanged-draft-key', async () => {
    calls.push('new');
  });
  second.register('unchanged-draft-key', async () => {
    calls.push('other-project');
  });
  oldCleanup();
  await first.flush();
  assert.deepEqual(calls, ['new']);
  cleanup();
  await first.flush();
  assert.deepEqual(calls, ['new']);
  await second.flush();
  assert.deepEqual(calls, ['new', 'other-project']);
});
