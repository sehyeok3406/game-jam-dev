import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorkspaceDataLoader } from '../src/ui/workspace/workspace-data.ts';
const sheets = {
  version: 1,
  canvases: [{ id: 'default', name: '기본' }],
  raw: null,
};
const state = (sessionId) => ({
  root: 'same-path',
  name: 'test',
  session: { projectKey: 'opaque', sessionId, epoch: 1 },
});
const document = (id, body) => ({ id, relativePath: `docs/${id}.md`, body });
const delta = (documents, signatures = {}, removed = []) => ({
  documents,
  sections: [],
  previews: [],
  signatures,
  removed,
  sheets,
});
test('workspace delta cache belongs to a project session and stale reads never replace it', async () => {
  let reply = delta([document('a', 'one')], { a: '1' });
  const known = [];
  const loader = new WorkspaceDataLoader({
    editor: {
      getCanvasChanges: async (signatures) => {
        known.push(signatures);
        return reply;
      },
    },
  });
  assert.equal(
    (await loader.begin().canvas(state('first'))).documents[0].body,
    'one',
  );
  reply = delta([document('a', 'two'), document('b', 'new')], {
    a: '2',
    b: '1',
  });
  assert.equal(
    (await loader.begin().canvas(state('first'))).documents.length,
    2,
  );
  assert.deepEqual(known[1], { a: '1' });
  reply = delta([], { b: '1' }, ['docs/a.md']);
  assert.deepEqual(
    (await loader.begin().canvas(state('first'))).documents.map((d) => d.id),
    ['b'],
  );
  reply = delta([document('a', 'reopened')], { a: '3' });
  assert.equal(
    (await loader.begin().canvas(state('second'))).documents.length,
    1,
  );
  assert.deepEqual(
    known[3],
    {},
    'same path with a new session requires a fresh delta baseline',
  );
  let resolve;
  reply = new Promise((done) => (resolve = done));
  const old = loader.begin();
  const stale = old.canvas(state('second'));
  loader.invalidate();
  reply = delta([document('a', 'latest')], { a: '4' });
  const current = loader.begin();
  await current.canvas(state('second'));
  resolve(delta([document('a', 'stale')], { a: 'stale' }));
  assert.equal(await stale, null);
  assert.equal(old.current(), false);
  assert.equal(current.current(), true);
  reply = delta([], { a: '4' });
  assert.equal(
    (await loader.begin().canvas(state('second'))).documents[0].body,
    'latest',
  );
  assert.deepEqual(known.at(-1), { a: '4' });
});
test('workspace subscription cleanup cancels pending loads and detaches exactly once', () => {
  let emit,
    stopped = 0,
    changed = 0;
  const loader = new WorkspaceDataLoader({
    projects: {
      onWorkspaceChanged: (listener) => {
        emit = listener;
        return () => stopped++;
      },
    },
  });
  const stop = loader.watch(() => changed++);
  const first = loader.begin();
  emit();
  assert.equal(changed, 1);
  assert.equal(first.current(), false);
  const second = loader.begin();
  stop();
  assert.equal(stopped, 1);
  assert.equal(second.current(), false);
});
