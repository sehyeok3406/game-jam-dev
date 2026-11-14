import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import matter from '../src/markdown.ts';
import {
  createTaskFiles,
  workflowStages,
  gameBuildTask,
} from '../src/task-plan.ts';
import { gamejamTaskInput } from '../src/gamejam-request.ts';
import { expectedArtifacts } from '../src/ai-artifacts.ts';
import { taskFileLock } from '../src/ai-file-lock.ts';
import { AiRunService } from '../src/application/ai/run-service.ts';
import { createGameBuildExecution } from '../src/application/ai/game-build-execution.ts';
import { validateGameBuildSource } from '../src/core/ai/game-build-source.ts';
import { isGameBuildAssetReference } from '../src/core/projects/game-build-assets.ts';
import {
  readGameBuild,
  readGameBuildIndex,
} from '../src/core/projects/game-build.ts';
import { gameBuildPublicationPaths } from '../src/core/projects/game-build-publication.ts';
import { gameBuildCodec as codec } from '../src/adapters/node/game-build-codec.ts';
import { planAiResult } from '../src/server/services/ai-result.ts';
import { applyExternalCommand } from '../src/application/editing/command-service.ts';

const taskPath = '.ai/tasks/task.md';
const idea = matter.stringify('목숨은 7개. 전투 금지.', {
  id: 'idea',
  title: 'idea',
  type: 'idea',
  status: 'draft',
  sources: [],
});
const built = {
  plan: {
    version: 1,
    entry: 'main.js',
    html: 'index.html',
    files: ['main.js', 'index.html'],
    assets: [],
  },
  sources: {
    'main.js': 'document.body.dataset.lives="7";',
    'index.html':
      '<!doctype html><html><body><script type="module" src="./main.js"></script></body></html>',
  },
  html: '<!doctype html><html><body><canvas></canvas></body></html>',
  lock: { version: 1, roots: {}, packages: [] },
  notices: { version: 1, packages: [] },
  profile: 'standalone-browser-v1',
  toolsetSha256: 'f'.repeat(64),
};
function fixture() {
  const files = { 'ideas/a.md': idea };
  const additions = createTaskFiles(
    {
      kind: 'implement',
      gameBuildVersion: 1,
      inputPaths: ['ideas/a.md'],
      instructions: '목숨은 7개. 전투 금지.',
      x: 0,
      y: 0,
    },
    'task',
    files,
  );
  const baseline = { ...files, ...additions },
    output = expectedArtifacts(baseline[taskPath])[0];
  let stage = { ...baseline },
    current = { ...baseline },
    fail = false;
  const history = [],
    calls = [];
  const repository = {
    capture: async () => ({ ...current }),
    saveHistory: async (before, changes, meta) => {
      history.push({ before, changes, status: meta.status });
      if (fail && meta.status === 'completed') throw Error('history failure');
    },
    apply: async (before, changes, cancelled) => {
      if (cancelled?.()) throw Error('cancelled');
      for (const [p, v] of Object.entries(changes)) {
        assert.equal(current[p], before[p]);
        if (v === null) delete current[p];
        else current[p] = v;
      }
    },
  };
  const service = new AiRunService(
    baseline,
    taskPath,
    {
      directory: 'private',
      capture: async () => ({ ...stage }),
      write: async (p, s) => {
        stage[p] = s;
      },
    },
    repository,
    async () => {},
    () => 123,
    {
      codec,
      id: randomUUID,
      executor: {
        run: async () => {
          throw Error('unexpected legacy executor');
        },
      },
      execution: {
        async execute(input, signal) {
          signal.throwIfAborted();
          calls.push(input);
          return structuredClone(built);
        },
      },
    },
  );
  const publication = {
    history: {
      id: 'run',
      createdAt: 1,
      label: 'build',
      kind: 'ai',
      status: 'starting',
    },
    lockBaseline: baseline,
    fileLock: taskFileLock(baseline, taskPath),
    cancelled: () => false,
    requiresLease: false,
    phase: () => {},
  };
  return {
    baseline,
    service,
    output,
    publication,
    history,
    calls,
    current: () => current,
    fail: () => {
      fail = true;
    },
    external: () => {
      current['ideas/unrelated.md'] = 'concurrent user note';
    },
  };
}

test('new gamejam implementation requests choose workflow v2 while saved v1 specifications remain valid', () => {
  const input = gamejamTaskInput({
    organize: false,
    implement: true,
    inputPaths: ['ideas/a.md'],
    instructions: { organize: 'docs', implement: 'game' },
    x: 0,
    y: 0,
  });
  assert.equal(input.gameBuildVersion, 1);
  const reduced = applyExternalCommand(
    { 'ideas/a.md': idea },
    'tasks:create',
    input,
  );
  assert.equal(gameBuildTask(reduced.files[reduced.result.relativePath]), true);
  const f = fixture();
  assert.equal(gameBuildTask(f.baseline[taskPath]), true);
  assert.deepEqual(workflowStages(f.baseline[taskPath]), []);
  const both = createTaskFiles(
    {
      ...input,
      kind: 'organize',
      documentResult: {
        mode: 'new',
        structure: 'custom',
        documents: [
          { key: 'd1', title: 'Rules', type: 'system', instructions: '' },
        ],
      },
      thenImplement: { instructions: 'game' },
    },
    'both',
    { 'ideas/a.md': idea },
  );
  const stages = workflowStages(both['.ai/tasks/both.md']);
  assert.equal(stages.length, 2);
  assert.equal(gameBuildTask(stages[1]), true);
  const old = createTaskFiles(
    { kind: 'implement', inputPaths: ['ideas/a.md'], x: 0, y: 0 },
    'old',
    { 'ideas/a.md': idea },
  );
  assert.equal(gameBuildTask(old['.ai/tasks/old.md']), false);
  assert.throws(() =>
    gameBuildTask(
      matter.stringify('', {
        gamejam_workflow_version: 2,
        game_build_version: 2,
      }),
    ),
  );
});
test('private source files cannot escape the declared bundle or bind unselected images', () => {
  assert.deepEqual(
    validateGameBuildSource(built.plan, built.sources, {}, Buffer.byteLength),
    built.plan,
  );
  for (const plan of [
    { ...built.plan, files: ['../escape.js', 'index.html'] },
    { ...built.plan, entry: 'other.js' },
    {
      ...built.plan,
      assets: [{ key: 'hero', path: 'assets/images/missing.png' }],
    },
    { ...built.plan, files: ['main.js', 'index.html', 'MAIN.js'] },
  ])
    assert.throws(() =>
      validateGameBuildSource(plan, built.sources, {}, Buffer.byteLength),
    );
});
test('source can declare an approved GLB without adding its binary to the snapshot', () => {
  const sha256 = 'a'.repeat(64);
  const asset = {
    kind: 'glb',
    path: `assets/models/${sha256}.glb`,
    sha256,
    bytes: 48_405_256,
  };
  const plan = {
    ...built.plan,
    assets: [{ key: 'model', path: asset.path }],
  };
  assert.deepEqual(
    validateGameBuildSource(plan, built.sources, {}, Buffer.byteLength, [
      asset,
    ]),
    plan,
  );
  assert.throws(() =>
    validateGameBuildSource(
      plan,
      built.sources,
      { [asset.path]: 'unexpected input' },
      Buffer.byteLength,
    ),
  );
});
test('project media references match their storage path and Blender output is content-addressed', () => {
  const sha256 = 'a'.repeat(64);
  const image = {
    key: 'art',
    kind: 'image',
    path: 'assets/images/art.png',
    sha256,
    bytes: 64,
  };
  const audio = { ...image, kind: 'audio', path: `assets/audio/${sha256}.wav` };
  const fbx = { ...image, kind: 'fbx', path: `assets/models/${sha256}.fbx` };
  const blend = {
    ...image,
    kind: 'blend',
    path: `assets/models/${sha256}.blend`,
    runtime: {
      path: `.gamejam/local/game-models/${sha256}.glb`,
      sha256,
      bytes: 40,
    },
  };
  for (const asset of [image, audio, fbx, blend])
    assert.equal(isGameBuildAssetReference(asset), true);
  for (const asset of [
    { ...image, path: 'assets/images/../art.png' },
    { ...audio, sha256: 'b'.repeat(64) },
    { ...fbx, kind: 'obj' },
    { ...blend, runtime: { ...blend.runtime, path: image.path } },
  ])
    assert.equal(isGameBuildAssetReference(asset), false);
});
test('preparation, source and compile use one cancellation/session boundary and always close resources', async () => {
  const calls = [];
  let valid = true;
  const ports = {
    preparation: () => ({
      run: async () => {
        calls.push('prepare');
        return null;
      },
      workspace() {
        throw Error('unused');
      },
      close: async () => {
        calls.push('close');
      },
    }),
    generate: async () => {
      calls.push('source');
      return built;
    },
    compile: async () => {
      calls.push('compile');
      return built;
    },
    assertCurrent() {
      if (!valid) throw Error('stale session');
    },
    progress() {},
  };
  await createGameBuildExecution(ports).execute(
    {},
    new AbortController().signal,
    () => {},
  );
  assert.deepEqual(calls, ['prepare', 'source', 'compile', 'close']);
  calls.length = 0;
  await assert.rejects(
    createGameBuildExecution({
      ...ports,
      generate: async () => {
        valid = false;
        return built;
      },
    }).execute({}, new AbortController().signal, () => {}),
    /stale session/,
  );
  assert.equal(calls.at(-1), 'close');
  assert.equal(calls.includes('compile'), false);
});
test('trusted source revision and HTML publish together through the existing repository and history', async () => {
  const f = fixture();
  await f.service.executePhase(
    { providerId: 'grok-cli' },
    new AbortController().signal,
    () => {},
  );
  assert.equal(f.current()[f.output], undefined);
  assert.equal(f.calls[0].inputs['ideas/a.md'], idea);
  const result = await f.service.validateFinal(
    () => {},
    () => {},
  );
  f.external();
  await f.service.publish(result.staged, result.outputs, f.publication);
  assert.equal(f.current()['ideas/unrelated.md'], 'concurrent user note');
  assert.equal(f.current()[f.output], built.html);
  const artifact = readGameBuildIndex(f.current()).artifacts[0],
    saved = readGameBuild(f.current(), artifact.buildId, codec);
  assert.deepEqual(saved.sources, built.sources);
  assert.equal(saved.manifest.documents[0].sha256, codec.digest(idea));
  assert.deepEqual(
    f.history.map((h) => h.status),
    ['validating', 'completed'],
  );
  assert.ok(
    taskFileLock(f.current(), taskPath).folders.includes(
      `.game-builds/${artifact.buildId}`,
    ),
  );
});
test('failed completion history rolls back new source, index and HTML together and keeps unrelated edits', async () => {
  const f = fixture();
  await f.service.executePhase({}, new AbortController().signal, () => {});
  const result = await f.service.validateFinal(
    () => {},
    () => {},
  );
  f.external();
  f.fail();
  await assert.rejects(
    f.service.publish(result.staged, result.outputs, f.publication),
    /history failure/,
  );
  assert.equal(f.current()[f.output], undefined);
  assert.equal(
    Object.keys(f.current()).some((p) => p.startsWith('.game-builds/')),
    false,
  );
  assert.equal(f.current()['ideas/unrelated.md'], 'concurrent user note');
});
test('shared completion only accepts the task HTML and one fresh complete source revision', async () => {
  const f = fixture();
  await f.service.executePhase({}, new AbortController().signal, () => {});
  const result = await f.service.validateFinal(
    () => {},
    () => {},
  );
  const allowed = [
      ...result.outputs,
      ...gameBuildPublicationPaths(
        f.baseline,
        result.staged,
        result.outputs,
        codec,
      ),
    ],
    artifacts = Object.fromEntries(allowed.map((p) => [p, result.staged[p]]));
  const job = {
      taskPath,
      baselineHash: codec.digest(JSON.stringify(f.baseline)),
    },
    project = { files: f.baseline };
  assert.equal(
    planAiResult(
      project,
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
  assert.throws(
    () =>
      planAiResult(
        project,
        job,
        { status: 'completed', artifacts },
        () => 1,
        codec.digest,
      ),
    /업데이트/,
  );
  assert.throws(
    () =>
      planAiResult(
        project,
        job,
        {
          status: 'completed',
          gameBuildVersion: 1,
          gameBuildEditingVersion: 1,
          artifacts: { ...artifacts, 'ideas/other.md': 'bad' },
        },
        () => 1,
        codec.digest,
      ),
    /허용된/,
  );
  const missing = { ...artifacts };
  delete missing[
    Object.keys(missing).find((p) => p.endsWith('/source/main.js'))
  ];
  assert.throws(() =>
    planAiResult(
      project,
      job,
      {
        status: 'completed',
        gameBuildVersion: 1,
        gameBuildEditingVersion: 1,
        artifacts: missing,
      },
      () => 1,
      codec.digest,
    ),
  );
});
