// Separate from npm test: uses the built portable Windows runtime and a local registry fixture.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import {
  NodeDependencyPreparationEngine,
  verifyGameBuildRuntime,
} from '../src/adapters/node/game-preparation/engine.ts';
import { prepareGameDependencies } from '../src/application/ai/dependency-preparation.ts';
import { AiDependencyFileExchange } from '../src/desktop/ai/dependency-preparation.ts';
const runtime = path.resolve(
  process.env.GAMEJAM_PREPARATION_RUNTIME ?? 'out/game-build-runtime',
);
const toolRequire = createRequire(path.join(runtime, 'npm/bin/npm-cli.js'));
const tar = toolRequire('tar');
const roots = [];
async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-dependencies-test-'),
  );
  roots.push(root);
  const versions = new Map(),
    requests = [];
  const server = http.createServer((q, r) => {
    const url = decodeURIComponent(q.url);
    requests.push(url);
    const item = versions.get(url);
    if (!item) {
      r.writeHead(404);
      r.end('{}');
      return;
    }
    r.end(Buffer.isBuffer(item) ? item : JSON.stringify(item));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const engine = new NodeDependencyPreparationEngine({
    runtime,
    cacheRoot: path.join(root, 'cache'),
    registryOrigin: `http://127.0.0.1:${server.address().port}`,
    assertCurrent() {},
  });
  t.after(async () => {
    await engine.close();
    await new Promise((resolve) => server.close(resolve));
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await fs.rm(root, { recursive: true, force: true });
  });
  async function pkg(
    name,
    version,
    {
      dependencies = {},
      scripts = {},
      badIntegrity = false,
      symlink = false,
      peerDependencies = {},
      readme = `# ${name} ${version}\nOfficial fixture API: value`,
      omitLicense = false,
    } = {},
  ) {
    const directory = path.join(root, 'pack', `${name}-${version}`, 'package');
    await fs.mkdir(directory, { recursive: true });
    const data = {
      name,
      version,
      license: 'MIT',
      dependencies,
      scripts,
      peerDependencies,
      types: 'index.d.ts',
    };
    await fs.writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify(data),
    );
    await fs.writeFile(path.join(directory, 'index.js'), 'export default 1;');
    await fs.writeFile(
      path.join(directory, 'index.d.ts'),
      'export declare const value: number;',
    );
    await fs.writeFile(path.join(directory, 'README.md'), readme);
    if (!omitLicense)
      await fs.writeFile(
        path.join(directory, 'LICENSE'),
        'Fixture MIT copyright and license notice',
      );
    if (symlink)
      await fs.symlink(
        root,
        path.join(directory, 'outside'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    const chunks = [];
    for await (const chunk of tar.c(
      { gzip: true, cwd: path.dirname(directory) },
      ['package'],
    ))
      chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    const dist = {
      tarball: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
      integrity: `sha512-${createHash('sha512')
        .update(badIntegrity ? Buffer.from('bad') : bytes)
        .digest('base64')}`,
    };
    versions.set(`/${name}/-/${name}-${version}.tgz`, bytes);
    const meta = { ...data, dist };
    const book = versions.get('/' + name) ?? { 'dist-tags': {}, versions: {} };
    book['dist-tags'].latest = version;
    book.versions[version] = meta;
    versions.set('/' + name, book);
    return meta;
  }
  return { root, engine, pkg, requests, versions };
}
const plan = (name, version = 'latest', extra = {}) => ({
  version: 1,
  action: 'prepare',
  packages: [{ name, version, reason: 'fixture choice' }],
  ...extra,
});
test('an empty saved lock accepts an explicit addition, version change, replacement and removal', async (t) => {
  const f = await fixture(t);
  await f.pkg('writer', '1.0.0');
  await f.pkg('writer', '2.0.0');
  await f.pkg('engine', '1.0.0', { dependencies: { writer: '1.0.0' } });
  const empty = { version: 1, roots: {}, packages: [] };
  const signal = new AbortController().signal;
  let lock = empty;
  async function apply(changes) {
    const result = await prepareGameDependencies(
      {
        runId: 'approved',
        previousLock: lock,
        changes,
        engine: f.engine,
        exchange: {
          turn() {
            throw Error('Explicit changes should use the app selection');
          },
          async close() {},
        },
        assertCurrent() {},
        progress() {},
      },
      signal,
    );
    lock = result.lock;
    return result;
  }
  const first = await apply([
    { action: 'add', name: 'writer', version: '1.0.0' },
  ]);
  assert.equal(first.selection[0].version, '1.0.0');
  const updated = await apply([{ action: 'update', name: 'writer' }]);
  assert.equal(updated.selection[0].version, '2.0.0');
  const replaced = await apply([
    { action: 'remove', name: 'writer' },
    { action: 'add', name: 'engine' },
  ]);
  assert.deepEqual(Object.keys(replaced.lock.roots), ['engine']);
  assert.equal(
    replaced.lock.packages.find((p) => p.name === 'writer').version,
    '1.0.0',
  );
  assert.deepEqual(
    (await apply([{ action: 'remove', name: 'engine' }])).lock,
    empty,
  );
  await assert.rejects(
    prepareGameDependencies(
      {
        runId: 'proposal',
        previousLock: empty,
        engine: {
          execute() {
            throw Error('An AI proposal must not reach package preparation');
          },
        },
        exchange: {
          async turn() {
            return {
              version: 1,
              runId: 'proposal',
              sequence: 1,
              request: plan('writer'),
            };
          },
          async close() {},
        },
        assertCurrent() {},
        progress() {},
      },
      signal,
    ),
    (error) => error.suggestedLibraries?.[0]?.name === 'writer',
  );
});
test('exact dependency graph, notices and API sources survive offline replay; cache corruption fails closed', async (t) => {
  const f = await fixture(t);
  await f.pkg('math', '1.0.0');
  await f.pkg('engine', '1.0.0', { dependencies: { math: '^1.0.0' } });
  const result = await f.engine.execute(
    plan('engine'),
    new AbortController().signal,
  );
  assert.equal(result.lock.packages.length, 2);
  assert.equal(result.notices.packages.length, 2);
  assert.equal(result.materials[0].documents.length, 2);
  assert.equal(result.selection[0].version, '1.0.0');
  for (const doc of result.materials[0].documents) {
    assert.equal(
      doc.sha256,
      createHash('sha256').update(doc.text).digest('hex'),
    );
    assert.equal(doc.sourceSha256, doc.sha256);
    assert.equal(doc.truncated, false);
  }
  assert.equal(
    result.materials[0].documents[0].source,
    'npm:engine@1.0.0/README.md',
  );
  const count = f.requests.length;
  f.versions.clear();
  const replay = await f.engine.execute(
    plan('engine', 'latest', { previousLock: result.lock }),
    new AbortController().signal,
  );
  assert.equal(replay.lockSha256, result.lockSha256);
  assert.deepEqual(replay.lock, result.lock);
  assert.equal(f.requests.length, count);
  assert.ok((await fs.readdir(f.engine.workspace())).includes('node_modules'));
  const archives = await fs.readdir(path.join(f.root, 'cache/archives'));
  await fs.writeFile(
    path.join(f.root, 'cache/archives', archives[0]),
    'corrupt',
  );
  await assert.rejects(
    f.engine.execute(
      plan('engine', 'latest', { previousLock: result.lock }),
      new AbortController().signal,
    ),
    /받지 못/,
  );
});
test('explicit upgrades retain unrelated exact versions and require declaration for conflicting requested versions', async (t) => {
  const f = await fixture(t);
  await f.pkg('math', '1.0.0');
  await f.pkg('engine', '1.0.0', { dependencies: { math: '^1.0.0' } });
  const first = await f.engine.execute(
    plan('engine'),
    new AbortController().signal,
  );
  await f.pkg('math', '1.1.0');
  await f.pkg('engine', '1.1.0', { dependencies: { math: '^1.0.0' } });
  await assert.rejects(
    f.engine.execute(
      plan('engine', '1.1.0', { previousLock: first.lock }),
      new AbortController().signal,
    ),
    (e) => e.code === 'LOCK_CHANGE',
  );
  const upgraded = await f.engine.execute(
    plan('engine', '1.1.0', { previousLock: first.lock, upgrades: ['engine'] }),
    new AbortController().signal,
  );
  assert.equal(
    upgraded.lock.packages.find((p) => p.name === 'math').version,
    '1.0.0',
  );
  assert.equal(
    upgraded.lock.packages.find((p) => p.name === 'engine').version,
    '1.1.0',
  );
});
test('git dependencies, install scripts, integrity mismatch, archive links and conflicting peers are rejected without executing package code', async (t) => {
  const f = await fixture(t);
  await f.pkg('git-source', '1.0.0', {
    dependencies: { unsafe: 'git+https://example.test/repo' },
  });
  await f.pkg('hook', '1.0.0', {
    scripts: { install: 'node -e "throw new Error(\'executed\')"' },
  });
  await f.pkg('corrupt', '1.0.0', { badIntegrity: true });
  await f.pkg('linked', '1.0.0', { symlink: true });
  await f.pkg('undocumented', '1.0.0', { omitLicense: true });
  for (const [name, code] of [
    ['git-source', 'SOURCE'],
    ['hook', 'INSTALL_SCRIPT'],
    ['corrupt', 'INTEGRITY'],
    ['linked', 'ARCHIVE_PATH'],
    ['undocumented', 'LICENSE'],
  ])
    await assert.rejects(
      f.engine.execute(plan(name), new AbortController().signal),
      (e) =>
        e.code === code ||
        (name === 'linked' &&
          /허용하지 않는 archive|ARCHIVE_PATH/.test(e.message)),
    );
  await f.pkg('host', '1.0.0');
  await f.pkg('host', '2.0.0');
  await f.pkg('plugin', '1.0.0', { peerDependencies: { host: '^1.0.0' } });
  await assert.rejects(
    f.engine.execute(
      {
        version: 1,
        action: 'prepare',
        packages: [
          { name: 'host', version: '2.0.0', reason: '' },
          { name: 'plugin', version: '1.0.0', reason: '' },
        ],
      },
      new AbortController().signal,
    ),
    (e) => e.code === 'PEER_CONFLICT',
  );
  assert.equal(
    (await fs.readdir(path.join(f.root, 'cache'))).some((p) =>
      p.startsWith('.work-'),
    ),
    false,
  );
});
test('cancellation and late session changes clean private staging and never return obsolete data', async (t) => {
  const f = await fixture(t);
  await f.pkg('engine', '1.0.0');
  const controller = new AbortController();
  const pending = f.engine.execute(plan('engine'), controller.signal);
  controller.abort(Error('cancelled run'));
  await assert.rejects(pending, /cancelled run/);
  const inFlight = new AbortController();
  f.versions.set('/blocked', {
    toJSON() {
      inFlight.abort(Error('cancelled download'));
      return {};
    },
  });
  await assert.rejects(
    f.engine.execute(plan('blocked'), inFlight.signal),
    /cancelled download/,
  );
  assert.equal(
    (await fs.readdir(path.join(f.root, 'cache'))).some((p) =>
      p.startsWith('.work-'),
    ),
    false,
  );
  let checks = 0;
  const stale = new NodeDependencyPreparationEngine({
    runtime,
    cacheRoot: path.join(f.root, 'stale'),
    registryOrigin: `http://127.0.0.1:1`,
    assertCurrent() {
      if (++checks > 1) throw Error('stale session');
    },
  });
  await assert.rejects(
    stale.execute(plan('engine'), new AbortController().signal),
    /stale session/,
  );
  await stale.close();
  await assert.rejects(verifyGameBuildRuntime(path.join(f.root, 'missing')));
});

test('nested conflicting dependencies resolve to the requested version rather than a shadowed ancestor', async (t) => {
  const f = await fixture(t);
  await f.pkg('x', '1.0.0');
  await f.pkg('x', '2.0.0');
  await f.pkg('b', '1.0.0', { dependencies: { x: '1.0.0' } });
  await f.pkg('b', '2.0.0');
  await f.pkg('a', '1.0.0', { dependencies: { b: '1.0.0', x: '2.0.0' } });
  const result = await f.engine.execute(
    {
      version: 1,
      action: 'prepare',
      packages: ['x', 'b', 'a'].map((name) => ({
        name,
        version: name === 'b' ? '2.0.0' : '1.0.0',
        reason: '',
      })),
    },
    new AbortController().signal,
  );
  const nested = result.lock.packages.find(
    (p) => p.name === 'b' && p.version === '1.0.0',
  );
  const nestedRequire = createRequire(
    path.join(f.engine.workspace(), nested.key, 'index.js'),
  );
  const dependency = JSON.parse(
    await fs.readFile(nestedRequire.resolve('x/package.json'), 'utf8'),
  );
  assert.equal(dependency.version, '1.0.0');
});

test('bounded API material preserves complete UTF-8 and identifies both supplied text and original file', async (t) => {
  const f = await fixture(t);
  const readme = '가'.repeat(20_000);
  await f.pkg('engine', '1.0.0', { readme });
  const result = await f.engine.execute(
    plan('engine'),
    new AbortController().signal,
  );
  const doc = result.materials[0].documents[0];
  assert.equal(doc.truncated, true);
  assert.equal(doc.text.includes('\ufffd'), false);
  assert.equal(
    doc.sourceSha256,
    createHash('sha256').update(readme).digest('hex'),
  );
  assert.equal(doc.sha256, createHash('sha256').update(doc.text).digest('hex'));
  assert.ok(Buffer.byteLength(doc.text) <= 32_000);
});

test('all four provider file exchanges consume real worker locks, notices and API data before confirmation', async (t) => {
  const f = await fixture(t);
  await f.pkg('engine', '1.0.0');
  for (const providerId of [
    'codex-cli',
    'claude-cli',
    'gemini-cli',
    'grok-cli',
  ]) {
    const runId = `fixture-${providerId}`;
    const exchange = new AiDependencyFileExchange({
      prepared: {
        runId,
        taskId: 't',
        stage: 'unused',
        providerId,
        modelId: null,
        executable: { executable: 'unused', prefix: [] },
        prompt: 'unused',
      },
      inputs: { 'ideas/source.md': '목숨 7개, 전투 금지' },
      assertCurrent() {},
      log() {},
      executor: {
        async run(input, _signal, emit) {
          const response = JSON.parse(
            input.inputFiles['.ai/tasks/dependency-response.json'],
          );
          if (response.sequence === 2) {
            assert.equal(response.response.selection[0].version, '1.0.0');
            assert.equal(response.response.notices.packages.length, 1);
            assert.equal(response.response.materials[0].documents.length, 2);
          }
          await fs.writeFile(
            path.join(
              input.stage,
              `.ai/tasks/dependency-request-${response.sequence}.json`,
            ),
            JSON.stringify({
              version: 1,
              runId,
              sequence: response.sequence,
              request:
                response.sequence === 1
                  ? plan('engine')
                  : {
                      version: 1,
                      action: 'done',
                      lockSha256: response.response.lockSha256,
                    },
            }),
          );
          if (providerId === 'grok-cli')
            emit({
              stream: 'stdout',
              text: '{"type":"end","stopReason":"end_turn"}\n',
            });
          return { code: 0 };
        },
      },
    });
    const result = await prepareGameDependencies(
      { runId, engine: f.engine, exchange, assertCurrent() {}, progress() {} },
      new AbortController().signal,
    );
    assert.equal(result.lock.packages[0].name, 'engine');
    await f.engine.close();
  }
});

test('portable toolset verification rejects extra files and changes to the packaged worker', async (t) => {
  const notices = await fs.readFile(
    path.join(runtime, 'THIRD-PARTY-NOTICES.txt'),
    'utf8',
  );
  for (const name of ['parse5@', 'postcss@', 'postcss-value-parser@', 'acorn@'])
    assert.ok(
      notices.includes(name),
      name + ' license must travel with the independent toolset',
    );
  const f = await fixture(t);
  const copy = path.join(f.root, 'runtime-copy');
  await fs.cp(runtime, copy, { recursive: true });
  await verifyGameBuildRuntime(copy);
  await fs.writeFile(path.join(copy, 'unregistered.txt'), 'extra');
  await assert.rejects(verifyGameBuildRuntime(copy), /미등록/);
  await fs.unlink(path.join(copy, 'unregistered.txt'));
  await fs.appendFile(path.join(copy, 'worker.mjs'), '\n// changed');
  await assert.rejects(verifyGameBuildRuntime(copy), /무결성/);
});
