import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from '../src/markdown.ts';
import { createTaskFiles, workflowStages } from '../src/task-plan.ts';
import { expectedArtifacts } from '../src/ai-artifacts.ts';
import { AiRunService } from '../src/application/ai/run-service.ts';
import { taskFileLock, aiLockedSnapshot } from '../src/ai-file-lock.ts';
import {
  createGameBuildRevision,
  gameBuildPublicationPaths,
} from '../src/core/projects/game-build-publication.ts';
import {
  appendGameBuild,
  readGameBuildIndex,
  readGameBuild,
} from '../src/core/projects/game-build.ts';
import { gameBuildCodec as codec } from '../src/adapters/node/game-build-codec.ts';
import { prepareGameDependencies } from '../src/application/ai/dependency-preparation.ts';
import { planAiResult } from '../src/server/services/ai-result.ts';
import { planHistoryRestoration } from '../src/server/services/history-restoration.ts';
import {
  materialize,
  captureProject,
  saveHistory,
  restoreHistory,
} from '../src/project-store.ts';

const doc = (body, data = {}) =>
  matter.stringify(body, {
    id: 'rules',
    title: 'Rules',
    type: 'overview',
    status: 'draft',
    sources: ['idea'],
    ...data,
  });
const idea = doc('원본 아이디어. 전투 금지.', {
  id: 'idea',
  type: 'idea',
  sources: [],
});
const imagePath = 'assets/images/hero.gif';
const image =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const emptyLock = { version: 1, roots: {}, packages: [] };
function built(lives = 7) {
  return {
    plan: {
      version: 1,
      entry: 'main.js',
      html: 'index.html',
      files: ['main.js', 'index.html', 'style.css'],
      assets: [{ key: 'hero', path: imagePath }],
    },
    sources: {
      'main.js': `document.body.dataset.lives='${lives}';`,
      'index.html':
        '<!doctype html><html><body><canvas></canvas><script type="module" src="./main.js"></script></body></html>',
      'style.css': 'body{background:navy}',
    },
    html: `<!doctype html><html><body><canvas data-lives="${lives}"></canvas></body></html>`,
    lock: emptyLock,
    notices: { version: 1, packages: [] },
    profile: 'standalone-browser-v1',
    toolsetSha256: 'f'.repeat(64),
  };
}
function revision(
  files,
  output = 'output/inbox/game/v001/index.html',
  artifactId = randomUUID(),
  lives = 7,
) {
  const result = built(lives),
    buildId = randomUUID();
  const r = createGameBuildRevision(
    {
      built: result,
      artifactId,
      buildId,
      output,
      documents: [
        {
          path: 'docs/game-overview.md',
          id: 'rules',
          sha256: codec.digest(files['docs/game-overview.md']),
        },
        { path: 'ideas/a.md', id: 'idea', sha256: codec.digest(idea) },
      ],
      instructionsVersion: '2:test',
      assetHashes: { [imagePath]: codec.digest(image) },
    },
    codec,
  );
  const bundle = {
    [r.prefix + '/manifest.json']: JSON.stringify(r.manifest),
    [r.prefix + '/dependencies.lock.json']: r.lock,
    [r.prefix + '/notices.json']: r.notices,
    ...Object.fromEntries(
      Object.entries(result.sources).map(([p, v]) => [
        r.prefix + '/source/' + p,
        v,
      ]),
    ),
  };
  const artifact = { artifactId, buildId, path: output };
  return {
    files: appendGameBuild(files, bundle, artifact, result.html, codec),
    artifact,
    result,
  };
}
function initial() {
  return revision({
    'ideas/a.md': idea,
    'docs/game-overview.md': doc('목숨 7개. 전투 금지.'),
    [imagePath]: image,
  });
}
function runFixture(initialFiles, options = {}) {
  const input = {
    kind: options.organize ? 'organize' : 'implement',
    gameBuildVersion: 1,
    inputPaths: ['docs/game-overview.md'],
    instructions: '규칙을 이어서 수정',
    x: 0,
    y: 0,
    htmlResult: {
      mode: options.mode ?? 'update',
      basePath:
        options.base ?? readGameBuildIndex(initialFiles).artifacts[0].path,
    },
    ...(options.organize
      ? {
          documentResult: { mode: 'update', baseDir: 'docs' },
          thenImplement: {
            instructions: '목숨 9개로 수정',
            htmlResult: {
              mode: 'update',
              basePath: readGameBuildIndex(initialFiles).artifacts[0].path,
            },
          },
        }
      : {}),
  };
  const baseline = {
      ...initialFiles,
      ...createTaskFiles(input, 'edit', initialFiles),
    },
    taskPath = '.ai/tasks/edit.md';
  let stage = { ...baseline },
    current = { ...baseline },
    fail = false;
  const seen = [],
    history = [];
  const service = new AiRunService(
    baseline,
    taskPath,
    {
      directory: 'private',
      capture: async () => ({ ...stage }),
      write: async (p, v) => {
        stage[p] = v;
      },
    },
    {
      capture: async () => ({ ...current }),
      saveHistory: async (before, after, meta) => {
        if (fail && meta.status === 'completed') throw Error('history failure');
        history.push({
          before,
          after,
          entry: {
            ...meta,
            files: Object.keys(after).map((relativePath) => ({ relativePath })),
          },
        });
      },
      apply: async (before, changes) => {
        for (const [p, v] of Object.entries(changes)) {
          assert.equal(current[p], before[p]);
          if (v === null) delete current[p];
          else current[p] = v;
        }
      },
    },
    async () => {},
    () => 1,
    {
      codec,
      id: randomUUID,
      executor: {
        run: async () => {
          throw Error('not used');
        },
      },
      execution: {
        execute: async (input) => {
          seen.push(input);
          return built(9);
        },
      },
    },
  );
  const publication = {
    lockBaseline: baseline,
    fileLock: taskFileLock(baseline, taskPath),
    cancelled: () => false,
    requiresLease: false,
    phase() {},
    history: {
      id: randomUUID(),
      kind: 'ai',
      label: 'edit',
      status: 'running',
      createdAt: 1,
    },
  };
  return {
    baseline,
    taskPath,
    service,
    seen,
    history,
    publication,
    current: () => current,
    stage: () => stage,
    write: (p, v) => {
      stage[p] = v;
    },
    external: (p, v) => {
      current[p] = v;
    },
    fail: () => {
      fail = true;
    },
  };
}
async function complete(f) {
  f.service.inspectInput();
  await f.service.executePhase({}, new AbortController().signal, () => {});
  const result = await f.service.validateFinal(
    () => {},
    () => {},
  );
  await f.service.publish(result.staged, result.outputs, f.publication);
  return result;
}

test('editing follows this game original, current design and images and gives an editable source copy', async () => {
  const base = initial();
  const files = {
    ...base.files,
    'docs/game-overview.md': doc('사용자가 저장한 목숨 9개. 전투 금지.'),
    'docs/unrelated.md': doc('다른 게임', { id: 'other' }),
  };
  const f = runFixture(files);
  assert.ok(
    !aiLockedSnapshot(f.baseline, f.publication.fileLock)['docs/unrelated.md'],
  );
  await complete(f);
  assert.deepEqual(f.seen[0].previousSource, {
    plan: base.result.plan,
    sources: base.result.sources,
  });
  assert.equal(f.seen[0].inputs[imagePath], image);
  assert.equal(f.seen[0].inputs['ideas/a.md'], idea);
  assert.equal(
    f.seen[0].inputs['docs/game-overview.md'],
    files['docs/game-overview.md'],
  );
  const updated = readGameBuildIndex(f.current()).artifacts[0];
  assert.equal(updated.artifactId, base.artifact.artifactId);
  assert.notEqual(updated.buildId, base.artifact.buildId);
  assert.equal(
    f.current()[`.game-builds/${base.artifact.buildId}/source/main.js`],
    base.result.sources['main.js'],
  );
  const saved = readGameBuild(f.current(), updated.buildId, codec);
  assert.equal(
    saved.manifest.documents.find((d) => d.id === 'rules').sha256,
    codec.digest(files['docs/game-overview.md']),
  );
  assert.equal(
    f.current()['docs/game-overview.md'],
    files['docs/game-overview.md'],
  );
});

test('a document-only update can explicitly edit the selected system document without running a source build', () => {
  const base = initial();
  const additions = createTaskFiles(
    {
      kind: 'organize',
      inputPaths: ['docs/game-overview.md'],
      documentResult: { mode: 'update', baseDir: 'docs' },
      x: 0,
      y: 0,
    },
    'docs-only',
    base.files,
  );
  const raw = additions['.ai/tasks/docs-only.md'];
  assert.deepEqual(matter(raw).data.document_updates, {
    version: 1,
    targets: [{ path: 'docs/game-overview.md', id: 'rules' }],
  });
  assert.deepEqual(workflowStages(raw), []);
  assert.equal(matter(raw).data.game_build_version, undefined);
});
test('new HTML version retains the selected source/lock and keeps the old game identity and files', async () => {
  const base = initial(),
    f = runFixture(base.files, { mode: 'new' });
  await complete(f);
  const artifacts = readGameBuildIndex(f.current()).artifacts;
  assert.equal(artifacts.length, 2);
  assert.deepEqual(
    artifacts.find((a) => a.path === base.artifact.path),
    base.artifact,
  );
  const fresh = artifacts.find((a) => a.path !== base.artifact.path);
  assert.equal(fresh.path, 'output/inbox/game/v002/game.html');
  assert.notEqual(fresh.artifactId, base.artifact.artifactId);
  assert.deepEqual(f.seen[0].previousLock, emptyLock);
  assert.equal(f.current()[base.artifact.path], base.result.html);
});
test('explicit system update targets allow selected input documents, protect ideas, and preserve edits on rollback', async () => {
  const base = initial();
  const f = runFixture(base.files, { organize: true });
  const stages = workflowStages(f.baseline[f.taskPath]);
  assert.deepEqual(matter(stages[0]).data.document_updates, {
    version: 1,
    targets: [{ path: 'docs/game-overview.md', id: 'rules' }],
  });
  f.service.inspectInput();
  await f.service.preparePhase();
  for (const p of expectedArtifacts(stages[0]))
    f.write(
      p,
      doc('AI 수정 목숨 9개', {
        id: p === 'docs/game-overview.md' ? 'rules' : randomUUID(),
        type: p.endsWith('open-questions.md') ? 'question' : 'system',
      }),
    );
  await f.service.advance();
  f.service.stageIndex = 1;
  await f.service.preparePhase();
  await f.service.executePhase({}, new AbortController().signal, () => {});
  assert.match(f.seen[0].inputs['docs/game-overview.md'], /목숨 9개/);
  const result = await f.service.validateFinal(
    () => {},
    () => {},
  );
  f.fail();
  await assert.rejects(
    f.service.publish(result.staged, result.outputs, f.publication),
    /history failure/,
  );
  assert.equal(
    f.current()['docs/game-overview.md'],
    base.files['docs/game-overview.md'],
  );
  assert.deepEqual(readGameBuildIndex(f.current()).artifacts, [base.artifact]);
  const bad = {
    ...base.files,
    'docs/game-overview.md': doc('원본 아이디어', { type: 'idea' }),
  };
  assert.throws(() => runFixture(bad, { organize: true }), /시스템 문서/);
});
test('related edits and changed source pointers reject publication while unrelated changes survive', async () => {
  for (const mutate of ['document', 'pointer']) {
    const base = initial(),
      f = runFixture(base.files);
    await f.service.executePhase({}, new AbortController().signal, () => {});
    const result = await f.service.validateFinal(
      () => {},
      () => {},
    );
    if (mutate === 'document')
      f.external('docs/game-overview.md', doc('외부 사용자 수정'));
    else {
      const next = revision(
        base.files,
        base.artifact.path,
        base.artifact.artifactId,
        7,
      );
      for (const [p, v] of Object.entries(next.files))
        if (p.startsWith('.game-builds/')) f.external(p, v);
    }
    await assert.rejects(
      f.service.publish(result.staged, result.outputs, f.publication),
      /변경/,
    );
    assert.equal(f.current()[base.artifact.path], base.result.html);
  }
});
test('server validates explicit update baseline identity before accepting a complete revision', async () => {
  const base = initial(),
    f = runFixture(base.files),
    result = await complete(f);
  const paths = [
    ...result.outputs,
    ...gameBuildPublicationPaths(
      f.baseline,
      result.staged,
      result.outputs,
      codec,
    ),
  ];
  const artifacts = Object.fromEntries(paths.map((p) => [p, result.staged[p]]));
  const job = {
    taskPath: f.taskPath,
    baselineHash: codec.digest(JSON.stringify(f.baseline)),
  };
  assert.equal(
    planAiResult(
      { files: f.baseline },
      job,
      {
        status: 'completed',
        gameBuildVersion: 1,
        gameBuildEditingVersion: 1,
        artifacts,
      },
      () => 1,
      codec.digest,
    ).success,
    true,
  );
  const parsed = matter(f.baseline[f.taskPath]);
  parsed.data.document_updates = {
    version: 1,
    targets: [{ path: 'ideas/a.md', id: 'idea' }],
  };
  const tampered = {
    ...f.baseline,
    [f.taskPath]: matter.stringify(parsed.content, parsed.data),
  };
  assert.throws(
    () =>
      planAiResult(
        { files: tampered },
        { ...job, baselineHash: codec.digest(JSON.stringify(tampered)) },
        {
          status: 'completed',
          gameBuildVersion: 1,
          gameBuildEditingVersion: 1,
          artifacts,
        },
        () => 1,
        codec.digest,
      ),
    /문서 갱신/,
  );
});
test('existing dependencies cannot be dropped by finishing preparation without preparing the fixed lock', async () => {
  const lock = {
    version: 1,
    roots: { engine: 'node_modules/engine' },
    packages: [
      {
        key: 'node_modules/engine',
        name: 'engine',
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/engine/-/engine-1.0.0.tgz',
        integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
        license: 'MIT',
        dependencies: [],
      },
    ],
  };
  let closed = false;
  await assert.rejects(
    prepareGameDependencies(
      {
        runId: 'run',
        previousLock: lock,
        assertCurrent() {},
        progress() {},
        engine: {
          execute() {
            throw Error('unused');
          },
        },
        exchange: {
          turn: async (sequence) => ({
            version: 1,
            runId: 'run',
            sequence,
            request: { version: 1, action: 'done', lockSha256: null },
          }),
          close: async () => {
            closed = true;
          },
        },
      },
      new AbortController().signal,
    ),
    /먼저 준비/,
  );
  assert.equal(closed, true);
});
test('local and server whole-history restores keep later games and restore source, HTML and docs together', async (t) => {
  const base = initial(),
    f = runFixture(base.files);
  await complete(f);
  const record = f.history.at(-1),
    other = revision(f.current(), 'output/inbox/other/v001/index.html');
  const restored = planHistoryRestoration(other.files, record, {
    version: 'before',
  });
  assert.deepEqual(
    readGameBuildIndex(restored).artifacts.find(
      (a) => a.path === base.artifact.path,
    ),
    base.artifact,
  );
  assert.deepEqual(
    readGameBuildIndex(restored).artifacts.find(
      (a) => a.path === other.artifact.path,
    ),
    other.artifact,
  );
  assert.equal(restored[base.artifact.path], base.result.html);
  const parent = await fs.realpath(os.tmpdir()),
    root = await fs.mkdtemp(path.join(parent, 'gamejam-edit-restore-'));
  t.after(async () => {
    assert.equal(path.dirname(root), parent);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  await materialize(root, other.files);
  const id = randomUUID();
  await saveHistory(root, record.before, record.after, {
    id,
    label: 'edit',
    kind: 'ai',
    status: 'completed',
    createdAt: 1,
    finishedAt: 2,
  });
  await restoreHistory(root, id, undefined, 'before');
  const local = await captureProject(root);
  assert.deepEqual(readGameBuildIndex(local), readGameBuildIndex(restored));
  await restoreHistory(root, id, undefined, 'after');
  const again = await captureProject(root);
  assert.equal(again[base.artifact.path], built(9).html);
  assert.deepEqual(
    readGameBuildIndex(again).artifacts.find(
      (a) => a.path === other.artifact.path,
    ),
    other.artifact,
  );
  await assert.rejects(
    restoreHistory(root, id, base.artifact.path, 'before'),
    /전체 기록/,
  );
});

test('restoring before a game creation removes its later revisions without orphaning or deleting another game', () => {
  const base = initial(),
    updated = revision(
      base.files,
      base.artifact.path,
      base.artifact.artifactId,
      9,
    ),
    other = revision(updated.files, 'output/inbox/other/v001/index.html');
  const after = Object.fromEntries(
    Object.entries(base.files).filter(
      ([p]) => p.startsWith('.game-builds/') || p === base.artifact.path,
    ),
  );
  const record = {
    before: {},
    after,
    entry: {
      files: Object.keys(after).map((relativePath) => ({ relativePath })),
    },
  };
  const restored = planHistoryRestoration(other.files, record, {
    version: 'before',
  });
  assert.deepEqual(readGameBuildIndex(restored).artifacts, [other.artifact]);
  assert.equal(restored[base.artifact.path], undefined);
  assert.equal(
    Object.keys(restored).some((p) =>
      p.startsWith(`.game-builds/${updated.artifact.buildId}/`),
    ),
    false,
  );
  assert.equal(
    restored['docs/game-overview.md'],
    base.files['docs/game-overview.md'],
  );
});
