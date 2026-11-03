import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import matter from '../src/markdown.ts';
import { buildFixture } from './helpers/game-build.mjs';
import { gameBuildCodec as codec } from '../src/adapters/node/game-build-codec.ts';
import {
  gameBuildStatus,
  gameDesignDigest,
} from '../src/core/projects/game-build-status.ts';
import {
  validateGameBuilds,
  readGameBuildIndex,
} from '../src/core/projects/game-build.ts';
import { PreviewExportService } from '../src/application/editing/preview-export-service.ts';
import { writeExportedHtml } from '../src/adapters/filesystem/html-export.ts';
import { replaceFileWithRetry } from '../src/adapters/filesystem/atomic-replace.ts';
import { describePreview, inspectImportedHtml } from '../src/html-source.ts';
import { applyCommand } from '../src/application/editing/command-service.ts';
import { createTaskFiles, gameBuildTask } from '../src/task-plan.ts';

function sourceFixture() {
  const f = buildFixture();
  f.files['docs/rules.md'] = matter.stringify('목숨 7개. 전투 금지.', {
    id: 'rules',
    title: '제작 기준',
    type: 'system',
    status: 'draft',
    sources: [],
  });
  const m = structuredClone(f.manifest),
    html =
      '<!doctype html><html><body><script type="module" src="./main.js"></script></body></html>';
  m.htmlTemplate = 'index.html';
  m.sources.push({
    path: 'index.html',
    bytes: codec.byteLength(html),
    sha256: codec.digest(html),
  });
  m.documents[0].sha256 = codec.digest(f.files['docs/rules.md']);
  m.documents[0].designSha256 = gameDesignDigest(
    f.files['docs/rules.md'],
    matter,
    codec.digest,
  );
  f.files[f.prefix + '/source/index.html'] = html;
  f.files[f.prefix + '/manifest.json'] = JSON.stringify(m);
  return { ...f, manifest: m };
}
async function temporary(t) {
  const parent = await fs.realpath(os.tmpdir()),
    root = await fs.mkdtemp(path.join(parent, 'gamejam-transfer-'));
  t.after(async () => {
    assert.equal(path.dirname(root), parent);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const workspace = path.join(root, 'project');
  await fs.mkdir(workspace);
  return { root, workspace };
}
test('atomic replacement retries a transient lock but preserves an intervening change and permanent errors', async (t) => {
  const { root } = await temporary(t),
    source = path.join(root, 'pending'),
    target = path.join(root, 'entry.json');
  await fs.writeFile(source, 'completed');
  await fs.writeFile(target, 'starting');
  let calls = 0;
  await replaceFileWithRetry(
    source,
    target,
    async () => {
      assert.equal(await fs.readFile(target, 'utf8'), 'starting');
    },
    async (a, b) => {
      if (!calls++)
        throw Object.assign(Error('sharing violation'), { code: 'EPERM' });
      return fs.rename(a, b);
    },
  );
  assert.equal(calls, 2);
  assert.equal(await fs.readFile(target, 'utf8'), 'completed');
  await fs.writeFile(source, 'stale');
  calls = 0;
  await assert.rejects(
    replaceFileWithRetry(
      source,
      target,
      async () => {
        if ((await fs.readFile(target, 'utf8')) !== 'completed')
          throw Error('history changed');
      },
      async () => {
        calls++;
        await fs.writeFile(target, 'newer history');
        throw Object.assign(Error('busy'), { code: 'EBUSY' });
      },
    ),
    /history changed/,
  );
  assert.equal(calls, 1);
  assert.equal(await fs.readFile(target, 'utf8'), 'newer history');
  calls = 0;
  await assert.rejects(
    replaceFileWithRetry(
      source,
      target,
      async () => {},
      async () => {
        calls++;
        throw Object.assign(Error('disk full'), { code: 'ENOSPC' });
      },
    ),
    /disk full/,
  );
  assert.equal(calls, 1);
});
test('build status exposes actual source, pinned libraries and design changes without mistaking layout edits for requirements', () => {
  const f = sourceFixture(),
    state = () => gameBuildStatus(f.files, f.artifact.path, codec, matter);
  assert.equal(state().kind, 'source');
  assert.deepEqual(state().libraries, [
    { name: 'example-engine', version: '1.2.3' },
  ]);
  assert.equal(state().documents[0].state, 'unchanged');
  const p = matter(f.files['docs/rules.md']);
  f.files['docs/rules.md'] = matter.stringify(p.content, {
    ...p.data,
    x: 120,
    y: 100,
    ai_task_path: '.ai/tasks/new.md',
    background_color: 'red',
    status_property_enabled: false,
  });
  assert.equal(state().documents[0].state, 'unchanged');
  f.files['docs/rules.md'] = matter.stringify('목숨 9개.', p.data);
  assert.equal(state().documents[0].state, 'changed');
  f.files['docs/rules.md'] = matter.stringify(p.content, {
    ...p.data,
    id: 'replacement',
  });
  assert.equal(state().documents[0].state, 'replaced');
  delete f.files['docs/rules.md'];
  assert.equal(state().documents[0].state, 'missing');
  delete f.files[f.prefix + '/source/main.js'];
  assert.equal(state().kind, 'unavailable');
});
test('older document baselines stay unknown after metadata changes; malformed semantic hashes fail validation', () => {
  const f = sourceFixture(),
    m = structuredClone(f.manifest);
  delete m.documents[0].designSha256;
  f.files[f.prefix + '/manifest.json'] = JSON.stringify(m);
  f.files['docs/rules.md'] += '\n';
  assert.equal(
    gameBuildStatus(f.files, f.artifact.path, codec, matter).documents[0].state,
    'unknown',
  );
  m.documents[0].designSha256 = 'bad';
  f.files[f.prefix + '/manifest.json'] = JSON.stringify(m);
  assert.throws(() => validateGameBuilds(f.files, codec), /baseline/);
});
test('semantic document hashes preserve meaningful YAML values and ignore serialization order', () => {
  const digest = (raw) => gameDesignDigest(raw, matter, codec.digest);
  assert.equal(
    digest('---\nid: a\ntitle: A\n---\ntext'),
    digest('---\ntitle: A\nid: a\n---\ntext\n'),
  );
  assert.notEqual(
    digest('---\nrelease: 2026-11-01\n---\nx'),
    digest('---\nrelease: 2026-11-02\n---\nx'),
  );
});
test('export writes the saved HTML exactly and re-import assigns a separate identity with no automatic dependency/source linking', async (t) => {
  const { root, workspace } = await temporary(t),
    f = sourceFixture(),
    target = path.join(root, 'export.html');
  const html =
    f.files[f.artifact.path] +
    '<script type="application/json" id="gamejam-build-provenance">' +
    JSON.stringify({
      artifactId: f.artifact.artifactId,
      buildId: f.artifact.buildId,
      dependencies: { command: 'do not run' },
    }) +
    '</script>';
  let current = { [f.artifact.path]: html };
  const service = new PreviewExportService({
    assertCurrent() {},
    capture: async () => ({ ...current }),
    validate: (p, content) => inspectImportedHtml(content, p),
    save: async (input, check) => {
      await writeExportedHtml(input.content, target, workspace, check);
      return true;
    },
  });
  assert.equal(await service.export(f.artifact.path), true);
  assert.deepEqual(await fs.readFile(target), Buffer.from(html));
  const imported = applyCommand(f.files, 'files:import-batch', {
    x: 0,
    y: 0,
    imagePurpose: 'asset',
    files: [
      { name: 'export.html', content: await fs.readFile(target, 'utf8') },
    ],
  });
  const importedPath = Object.keys(imported.files).find(
    (p) => p.endsWith('.html') && !f.files[p],
  );
  assert.ok(importedPath);
  assert.equal(
    describePreview(imported.files, importedPath).build.kind,
    'html',
  );
  assert.deepEqual(
    readGameBuildIndex(imported.files),
    readGameBuildIndex(f.files),
  );
  const tasks = createTaskFiles(
    {
      kind: 'implement',
      gameBuildVersion: 1,
      sourceMode: 'html-compose',
      inputPaths: [importedPath],
      htmlResult: { mode: 'new' },
      x: 0,
      y: 0,
    },
    'reimport',
    imported.files,
  );
  assert.equal(gameBuildTask(tasks['.ai/tasks/reimport.md']), true);
  assert.equal(imported.files[importedPath], html);
});
test('cancellation, changed HTML and stale sessions leave an existing export untouched', async (t) => {
  const { root, workspace } = await temporary(t),
    target = path.join(root, 'export.html');
  await fs.writeFile(target, 'old export');
  for (const scenario of ['cancel', 'change', 'session']) {
    let content = '<html><body>saved</body></html>',
      valid = true;
    const service = new PreviewExportService({
      assertCurrent() {
        if (!valid) throw Error('stale session');
      },
      capture: async () => ({ 'output/index.html': content }),
      validate() {},
      save: async (input, check) => {
        if (scenario === 'cancel') return false;
        if (scenario === 'change') content = '<html>changed</html>';
        else valid = false;
        await writeExportedHtml(input.content, target, workspace, check);
        return true;
      },
    });
    if (scenario === 'cancel')
      assert.equal(await service.export('output/index.html'), false);
    else
      await assert.rejects(service.export('output/index.html'), /변경|stale/);
    assert.equal(await fs.readFile(target, 'utf8'), 'old export');
  }
  let checks = 0;
  await assert.rejects(
    writeExportedHtml('new', target, workspace, async () => {
      if (++checks === 2) throw Error('late conflict');
    }),
    /late conflict/,
  );
  assert.equal(await fs.readFile(target, 'utf8'), 'old export');
  assert.deepEqual(
    (await fs.readdir(root)).filter((p) => p.startsWith('.gamejam-export-')),
    [],
  );
});
test('exports cannot bypass project storage through direct paths or directory junctions', async (t) => {
  const { root, workspace } = await temporary(t);
  await assert.rejects(
    writeExportedHtml(
      'bad',
      path.join(workspace, 'index.html'),
      workspace,
      async () => {},
    ),
    /プロジェクト|프로젝트 밖/,
  );
  const alias = path.join(root, 'alias');
  await fs.symlink(
    workspace,
    alias,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(
    writeExportedHtml(
      'bad',
      path.join(alias, 'index.html'),
      workspace,
      async () => {},
    ),
    /프로젝트 밖/,
  );
  assert.deepEqual(await fs.readdir(workspace), []);
});
