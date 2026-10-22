import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { createMemoryPreferences } from '../src/ui/runtime/preferences.ts';

test('development runtimes isolate edits, drafts, history and subscriptions and share save conflict rules', async (t) => {
  const parent = path.resolve('out');
  await fs.mkdir(parent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(parent, 'runtime-fixtures-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      ssr: 'src/dev-api.ts',
      outDir: directory,
      emptyOutDir: false,
      rollupOptions: {
        output: { format: 'es', entryFileNames: 'fixture.mjs' },
      },
    },
  });
  const { createDevGameCanvasApi } = await import(
    pathToFileURL(path.join(directory, 'fixture.mjs')).href
  );
  const one = createDevGameCanvasApi(createMemoryPreferences());
  const two = createDevGameCanvasApi(createMemoryPreferences());
  const before = await two.listDocuments();
  const original = before[0];
  let changes = 0;
  const stop = two.onWorkspaceChanged(() => changes++);
  await one.saveDocument({
    relativePath: original.relativePath,
    title: '  변경 제목  ',
    body: '분리된 본문',
    expectedBody: original.body,
    expectedTitle: original.title,
    objectId: original.id,
  });
  assert.deepEqual(await two.listDocuments(), before);
  assert.equal(changes, 0);
  assert.equal(
    (await one.getDocument(original.relativePath)).title,
    '변경 제목',
  );
  assert.equal((await two.listHistory()).length, 0);
  assert.ok((await one.listHistory()).length > 0);
  await one.setEditorDraft(
    'same-key',
    { title: '초안', body: '인스턴스별 초안', sequence: 1 },
    1,
  );
  assert.equal(await two.getEditorDraft('same-key'), null);
  await assert.rejects(
    one.saveDocument({
      relativePath: original.relativePath,
      title: '덮어쓰기',
      body: '실패해야 함',
      expectedBody: original.body,
      expectedTitle: original.title,
    }),
    /변경/,
  );
  await assert.rejects(
    one.saveDocument({
      relativePath: original.relativePath,
      title: '다른 ID',
      body: '',
      objectId: 'replaced',
    }),
    /식별자/,
  );
  assert.equal(
    (await one.getDocument(original.relativePath)).body,
    '분리된 본문',
  );
  stop();
});
