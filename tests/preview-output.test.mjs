import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  isPreviewPath,
  assertPreviewPath,
  nextPreviewPath,
  previewLabel,
  previewWindowPath,
} from '../src/preview-output.ts';
import {
  captureProject,
  materialize,
  saveHistory,
  restoreHistory,
} from '../src/project-store.ts';
import { expectedArtifacts } from '../src/ai-artifacts.ts';

test('version paths are restricted, ordered and reserved independently from legacy output', () => {
  assert.equal(
    nextPreviewPath(['output/index.html']),
    'output/games/v2/index.html',
  );
  assert.equal(
    nextPreviewPath([
      'output/index.html',
      'output/versions/v2.html',
      'output/versions/v7.html',
    ]),
    'output/games/v8/index.html',
  );
  assert.equal(previewLabel('output/versions/v2.html'), '버전 2');
  assert.equal(previewWindowPath(), '.canvas/preview.json');
  assert.equal(
    previewWindowPath('output/versions/v2.html'),
    '.canvas/previews/v2.json',
  );
  for (const invalid of [
    '../index.html',
    'output/versions/../index.html',
    'output/versions/v02.html',
    'output/other.html',
    'C:/temp/file.html',
    'output/versions/v2.html/other',
  ]) {
    assert.equal(isPreviewPath(invalid), false);
    assert.throws(() => assertPreviewPath(invalid));
    assert.throws(() =>
      expectedArtifacts(`---\nexpected_outputs:\n  - ${invalid}\n---\n`),
    );
  }
  assert.deepEqual(
    expectedArtifacts(
      '---\nexpected_outputs:\n  - output/versions/v2.html\n---\n',
    ),
    ['output/versions/v2.html'],
  );
});

test('snapshots and history restore one HTML version without touching other results', async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'game-canvas-versions-'),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const before = {
    'output/index.html': '<html><body>v1</body></html>',
    'output/versions/v2.html': '<html><body>old v2</body></html>',
  };
  const after = {
    ...before,
    'output/versions/v2.html': '<html><body>updated v2</body></html>',
  };
  await materialize(root, after);
  assert.deepEqual(await captureProject(root), after);
  await saveHistory(root, before, after, {
    id: 'version-history',
    label: '버전 2 갱신',
    kind: 'ai',
    status: 'completed',
    createdAt: Date.now(),
  });
  await restoreHistory(
    root,
    'version-history',
    'output/versions/v2.html',
    'before',
  );
  assert.deepEqual(await captureProject(root), before);
});
