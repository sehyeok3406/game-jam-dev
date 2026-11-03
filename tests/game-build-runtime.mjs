// Explicit runtime suite; built portable tools are required, external services are not.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { compileStandaloneGame } from '../src/adapters/node/game-preparation/compile.ts';
import { verifyGameBuildRuntime } from '../src/adapters/node/game-preparation/engine.ts';
import { desktopGameBuildExecution } from '../src/desktop/ai/game-build-execution.ts';

const runtime = path.resolve(
  process.env.GAMEJAM_PREPARATION_RUNTIME ?? 'out/game-build-runtime',
);
const assetPath = 'assets/images/hero.gif',
  image =
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const source = () => ({
  plan: {
    version: 1,
    entry: 'main.js',
    html: 'index.html',
    files: ['main.js', 'index.html', 'style.css'],
    assets: [{ key: 'hero', path: assetPath }],
  },
  sources: {
    'main.js':
      "import './style.css';import assets from 'gamejam:assets'; document.body.dataset.lives='7';document.querySelector('#hero').src=assets.hero;",
    'index.html':
      '<!doctype html><html><head><title>목숨 7개</title></head><body><img id="hero" src="gamejam:asset/hero"><canvas></canvas><script type="module" src="./main.js"></script></body></html>',
    'style.css':
      'body{background:#15243a;color:white}canvas{background-image:url(gamejam:asset/hero)}',
  },
});
async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir()),
    root = await fs.mkdtemp(path.join(parent, 'gamejam-build-runtime-'));
  t.after(async () => {
    assert.equal(path.dirname(root), parent);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const options = {
    runtime,
    cacheRoot: path.join(root, 'cache'),
    assertCurrent() {},
  };
  return {
    root,
    options,
    compile: (
      s = source(),
      deps = null,
      depRoot = null,
      signal = new AbortController().signal,
    ) =>
      compileStandaloneGame(
        options,
        s,
        { [assetPath]: image },
        deps,
        depRoot,
        signal,
      ),
  };
}
test('actual bundler embeds local JS, CSS, selected images, profile and inert notices into one HTML', async (t) => {
  const f = await fixture(t),
    result = await f.compile();
  assert.equal(result.profile, 'standalone-browser-v1');
  assert.ok(result.html.includes(image));
  assert.ok(result.html.includes('#15243a'));
  assert.ok(result.html.includes('gamejam-license-notices'));
  assert.ok(result.html.includes('gamejam-build-provenance'));
  assert.equal(result.html.includes('src="./main.js"'), false);
  assert.equal(result.html.includes('gamejam:asset/hero'), false);
  assert.equal(result.html.split(image).length - 1, 1); // Reusing a sprite in HTML/CSS/JS must not triple the embedded payload.
  assert.equal(result.html.includes(f.options.cacheRoot), false);
  assert.equal(/\b[A-Za-z]:[\\/]/.test(result.html), false);
  assert.equal(
    (await fs.readdir(f.options.cacheRoot)).some((p) => p.startsWith('.work-')),
    false,
  );
});
test('declared package exports and transitive imports bundle from the prepared graph', async (t) => {
  const f = await fixture(t),
    root = path.join(f.root, 'dependencies');
  for (const [name, code, extra] of [
    [
      'engine',
      "import {value} from 'math';export const lives=value;",
      { dependencies: { math: '1.0.0' } },
    ],
    ['math', 'export const value=7;', {}],
  ]) {
    const dir = path.join(root, 'node_modules', name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({
        name,
        version: '1.0.0',
        type: 'module',
        exports: './index.js',
        ...extra,
      }),
    );
    await fs.writeFile(path.join(dir, 'index.js'), code);
  }
  const tool = await verifyGameBuildRuntime(runtime),
    lock = {
      version: 1,
      roots: { engine: 'node_modules/engine' },
      packages: ['engine', 'math'].map((name) => ({
        key: 'node_modules/' + name,
        name,
        version: '1.0.0',
        resolved: `https://registry.npmjs.org/${name}/-/${name}-1.0.0.tgz`,
        integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
        dependencies: name === 'engine' ? ['node_modules/math'] : [],
        license: 'MIT',
      })),
    };
  const s = source();
  s.sources['main.js'] =
    "import {lives} from 'engine';document.body.dataset.lives=String(lives);";
  const result = await f.compile(
    s,
    {
      lock,
      notices: {
        version: 1,
        packages: lock.packages.map((p) => ({
          key: p.key,
          license: 'MIT',
          text: p.name + ' fixture MIT notice',
        })),
      },
      toolsetSha256: tool.sha256,
    },
    root,
  );
  assert.ok(result.html.includes('fixture MIT notice'));
  assert.equal(/from ["'](?:engine|math)/.test(result.html), false);
});
test('undeclared packages, Node/URL/escaping imports, remote resources and executable extra scripts fail closed', async (t) => {
  const f = await fixture(t);
  for (const code of [
    "import 'unprepared-engine';",
    "import fs from 'node:fs';",
    "import 'https://example.test/game.js';",
    "import '../build-input.json';",
    "const dependency='not-prepared';import(dependency);",
  ]) {
    const s = source();
    s.sources['main.js'] = code;
    await assert.rejects(f.compile(s), /의존성|import|모듈/);
  }
  for (const edit of [
    (s) =>
      (s.sources['index.html'] = s.sources['index.html'].replace(
        'gamejam:asset/hero',
        'https://example.test/hero.png',
      )),
    (s) => (s.sources['index.html'] += '<script>alert(1)</script>'),
    (s) => (s.sources['style.css'] = 'body{background:url(file:///secret)}'),
  ]) {
    const s = source();
    edit(s);
    await assert.rejects(f.compile(s));
  }
  assert.equal(
    (await fs.readdir(f.options.cacheRoot)).some((p) => p.startsWith('.work-')),
    false,
  );
});
test('all four providers complete preparation → scoped source files → actual standalone bundle with the same input', async (t) => {
  const f = await fixture(t);
  for (const providerId of [
    'codex-cli',
    'claude-cli',
    'gemini-cli',
    'grok-cli',
  ]) {
    let turns = 0,
      sources = 0;
    const execution = desktopGameBuildExecution({
      ...f.options,
      progress() {},
      executor: {
        async run(input, _signal, emit) {
          if (input.inputFiles['.ai/tasks/dependency-response.json']) {
            turns++;
            const response = JSON.parse(
              input.inputFiles['.ai/tasks/dependency-response.json'],
            );
            await fs.writeFile(
              path.join(
                input.stage,
                `.ai/tasks/dependency-request-${response.sequence}.json`,
              ),
              JSON.stringify({
                version: 1,
                runId: input.runId,
                sequence: response.sequence,
                request: { version: 1, action: 'done', lockSha256: null },
              }),
            );
          } else {
            sources++;
            assert.equal(
              input.inputFiles['ideas/source.md'],
              '목숨은 7개. 전투 금지.',
            );
            const s = source();
            await fs.mkdir(path.join(input.stage, 'source'));
            for (const [p, text] of Object.entries(s.sources))
              await fs.writeFile(path.join(input.stage, 'source', p), text);
            await fs.writeFile(
              path.join(input.stage, 'source-plan.json'),
              JSON.stringify(s.plan),
            );
          }
          if (providerId === 'grok-cli')
            emit({
              stream: 'stdout',
              text: '{"type":"end","stopReason":"end_turn"}\n',
            });
          return { code: 0 };
        },
      },
    });
    const result = await execution.execute(
      {
        prepared: {
          runId: 'test-' + providerId,
          taskId: '.ai/tasks/task.md',
          providerId,
          stage: 'unused',
          modelId: null,
          executable: { executable: 'unused', prefix: [] },
          prompt: 'unused',
        },
        specification: 'original task',
        inputs: {
          'ideas/source.md': '목숨은 7개. 전투 금지.',
          '.ai/tasks/task.md': 'original task',
          [assetPath]: image,
        },
      },
      new AbortController().signal,
      () => {},
    );
    assert.equal(turns, 1);
    assert.equal(sources, 1);
    assert.ok(result.html.includes('dataset.lives'));
    assert.deepEqual(result.lock.packages, []);
  }
});
test('source edits to protected inputs are rejected and cancellation leaves no build directories', async (t) => {
  const f = await fixture(t),
    controller = new AbortController();
  controller.abort(Error('cancelled'));
  await assert.rejects(
    f.compile(source(), null, null, controller.signal),
    /cancelled/,
  );
  const execution = desktopGameBuildExecution({
    ...f.options,
    progress() {},
    executor: {
      async run(input) {
        const responseText =
          input.inputFiles['.ai/tasks/dependency-response.json'];
        if (responseText) {
          const response = JSON.parse(responseText);
          await fs.writeFile(
            path.join(
              input.stage,
              `.ai/tasks/dependency-request-${response.sequence}.json`,
            ),
            JSON.stringify({
              version: 1,
              runId: input.runId,
              sequence: response.sequence,
              request: { version: 1, action: 'done', lockSha256: null },
            }),
          );
        } else
          await fs.writeFile(
            path.join(input.stage, 'ideas/source.md'),
            'rewritten',
          );
        return { code: 0 };
      },
    },
  });
  await assert.rejects(
    execution.execute(
      {
        prepared: {
          runId: 'protected',
          taskId: '.ai/tasks/task.md',
          providerId: 'codex-cli',
          stage: 'unused',
          modelId: null,
          executable: { executable: 'unused', prefix: [] },
          prompt: 'unused',
        },
        specification: 'task',
        inputs: { 'ideas/source.md': 'original', '.ai/tasks/task.md': 'task' },
      },
      new AbortController().signal,
      () => {},
    ),
    /원본 입력/,
  );
});

test('all four providers receive seeded editable sources and unchanged style/assets survive an actual rebuild', async (t) => {
  const f = await fixture(t);
  for (const providerId of [
    'codex-cli',
    'claude-cli',
    'gemini-cli',
    'grok-cli',
  ]) {
    const previous = source();
    const execution = desktopGameBuildExecution({
      ...f.options,
      progress() {},
      executor: {
        async run(input, _signal, emit) {
          const responseText =
            input.inputFiles['.ai/tasks/dependency-response.json'];
          if (responseText) {
            const r = JSON.parse(responseText);
            await fs.writeFile(
              path.join(
                input.stage,
                `.ai/tasks/dependency-request-${r.sequence}.json`,
              ),
              JSON.stringify({
                version: 1,
                runId: input.runId,
                sequence: r.sequence,
                request: { version: 1, action: 'done', lockSha256: null },
              }),
            );
          } else {
            const main = await fs.readFile(
              path.join(input.stage, 'source/main.js'),
              'utf8',
            );
            assert.equal(main, previous.sources['main.js']);
            assert.equal(
              input.inputFiles['source/main.js'],
              main,
              'write-only providers also receive the editable source bytes',
            );
            const context = JSON.parse(
              input.inputFiles['.ai/tasks/game-build-context.json'],
            );
            assert.deepEqual(context.previousSource, previous.plan);
            await fs.writeFile(
              path.join(input.stage, 'source/main.js'),
              main.replace("lives='7'", "lives='9'"),
            );
          }
          if (providerId === 'grok-cli')
            emit({
              stream: 'stdout',
              text: '{"type":"end","stopReason":"end_turn"}\n',
            });
          return { code: 0 };
        },
      },
    });
    const result = await execution.execute(
      {
        prepared: {
          runId: 'edit-' + providerId,
          taskId: '.ai/tasks/task.md',
          providerId,
          stage: 'unused',
          modelId: null,
          executable: { executable: 'unused', prefix: [] },
          prompt: 'unused',
        },
        specification: 'edit game',
        inputs: { [assetPath]: image, '.ai/tasks/task.md': 'edit game' },
        previousSource: previous,
        previousLock: { version: 1, roots: {}, packages: [] },
      },
      new AbortController().signal,
      () => {},
    );
    assert.match(result.html, /lives = "9"/);
    assert.equal(result.sources['style.css'], previous.sources['style.css']);
    assert.deepEqual(result.plan.assets, previous.plan.assets);
    assert.equal(previous.sources['main.js'], source().sources['main.js']);
  }
});
