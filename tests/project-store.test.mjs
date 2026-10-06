import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  applyChanges,
  captureProject,
  historyId,
  listHistory,
  materialize,
  projectPath,
  readHistoryFile,
  recoverInterruptedHistory,
  restoreHistory,
  saveHistory,
} from '../src/project-store.ts';
import { expectedArtifacts, validateArtifacts } from '../src/ai-artifacts.ts';

async function temporaryProject(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'game-canvas-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
const meta = (label = '작업') => ({
  id: historyId(),
  label,
  kind: 'user',
  status: 'completed',
  createdAt: Date.now(),
});

test('conflict on any target prevents all outputs from being overwritten', async (t) => {
  const root = await temporaryProject(t);
  const before = { 'docs/a.md': 'old A', 'output/index.html': 'old HTML' };
  await materialize(root, before);
  await fs.writeFile(path.join(root, 'output/index.html'), 'external edit');
  await assert.rejects(
    applyChanges(root, before, {
      'docs/a.md': 'new A',
      'output/index.html': 'new HTML',
    }),
    /외부 변경/,
  );
  assert.equal(
    await fs.readFile(path.join(root, 'docs/a.md'), 'utf8'),
    'old A',
  );
  assert.equal(
    await fs.readFile(path.join(root, 'output/index.html'), 'utf8'),
    'external edit',
  );
});

test('cancellation during publication rolls back already-written files', async (t) => {
  const root = await temporaryProject(t);
  const before = { 'docs/a.md': 'old A', 'docs/b.md': 'old B' };
  await materialize(root, before);
  let checks = 0;
  await assert.rejects(
    applyChanges(
      root,
      before,
      { 'docs/a.md': 'new A', 'docs/b.md': 'new B' },
      () => ++checks === 2,
    ),
    /중지/,
  );
  assert.deepEqual(await captureProject(root), before);
});

test('deleted document and section membership restore together, and the previous state remains recoverable', async (t) => {
  const root = await temporaryProject(t);
  const before = { 'ideas/a.md': 'idea', 'sections/a.md': 'members: a' };
  const after = { 'sections/a.md': 'members: []' };
  await materialize(root, after);
  const deletion = await saveHistory(root, before, after, meta('문서 삭제'));
  await restoreHistory(root, deletion.id);
  assert.deepEqual(await captureProject(root), before);
  const restored = (await listHistory(root)).find(
    (entry) => entry.kind === 'restore',
  );
  assert.ok(restored);
  assert.equal(
    await readHistoryFile(root, restored.id, 'sections/a.md', 'before'),
    'members: []',
  );
  assert.equal(
    await readHistoryFile(root, restored.id, 'ideas/a.md', 'before'),
    null,
  );
  await restoreHistory(root, restored.id, undefined, 'before');
  assert.deepEqual(await captureProject(root), after);
});

test('history restores the selected content without reverting unrelated files', async (t) => {
  const root = await temporaryProject(t);
  const entry = await saveHistory(
    root,
    { 'docs/a.md': 'v1' },
    { 'docs/a.md': 'v2' },
    meta(),
  );
  await materialize(root, { 'docs/a.md': 'v3', 'docs/unrelated.md': 'keep' });
  await restoreHistory(root, entry.id, 'docs/a.md', 'before');
  assert.deepEqual(await captureProject(root), {
    'docs/a.md': 'v1',
    'docs/unrelated.md': 'keep',
  });
});

test('interrupted publication is rolled back on restart', async (t) => {
  const root = await temporaryProject(t);
  const before = { 'docs/a.md': 'old A', 'docs/b.md': 'old B' };
  const after = { 'docs/a.md': 'new A', 'docs/b.md': 'new B' };
  await materialize(root, { 'docs/a.md': 'new A', 'docs/b.md': 'old B' });
  const entry = await saveHistory(root, before, after, {
    ...meta(),
    kind: 'ai',
    status: 'validating',
  });
  await recoverInterruptedHistory(root);
  assert.deepEqual(await captureProject(root), before);
  assert.equal(
    (await listHistory(root)).find((item) => item.id === entry.id).status,
    'failed',
  );
});

test('workspace path traversal is rejected', async (t) => {
  const root = await temporaryProject(t);
  await assert.rejects(projectPath(root, '../outside.md'));
  assert.deepEqual(
    expectedArtifacts('---\nexpected_outputs:\n  - output/index.html\n---\n'),
    ['output/index.html'],
  );
  assert.throws(() =>
    expectedArtifacts('---\nexpected_outputs:\n  - docs/../outside.md\n---\n'),
  );
});

test('unchanged, empty and invalid-source artifacts cannot pass validation', () => {
  const before = {
    'ideas/a.md': '---\nid: idea-a\n---\nidea',
    'output/index.html': '<html><body>old</body></html>',
  };
  assert.throws(
    () => validateArtifacts(before, before, ['output/index.html']),
    /갱신/,
  );
  assert.throws(
    () =>
      validateArtifacts(before, { ...before, 'output/index.html': '' }, [
        'output/index.html',
      ]),
    /비어/,
  );
  const document = (id) =>
    `---\nid: output-a\ntitle: 결과\ntype: system\nstatus: draft\nsources:\n  - id: ${id}\n---\ncontent`;
  assert.throws(
    () =>
      validateArtifacts(
        before,
        { ...before, 'docs/a.md': document('missing') },
        ['docs/a.md'],
      ),
    /출처/,
  );
  validateArtifacts(before, { ...before, 'docs/a.md': document('idea-a') }, [
    'docs/a.md',
  ]);
});
