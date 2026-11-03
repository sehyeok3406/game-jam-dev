import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  parseDependencyRequest,
  parseDependencyExchange,
} from '../src/core/ai/dependency-preparation.ts';
import { prepareGameDependencies } from '../src/application/ai/dependency-preparation.ts';
import { AiDependencyFileExchange } from '../src/desktop/ai/dependency-preparation.ts';

test('dependency requests restrict transport sources and fields, not library names', () => {
  for (const name of [
    'pixi.js',
    'three',
    'matter-js',
    '@scope/arbitrary-engine',
  ])
    assert.equal(
      parseDependencyRequest({ version: 1, action: 'research', names: [name] })
        .names[0],
      name,
    );
  for (const request of [
    { version: 2, action: 'research', names: ['three'] },
    { version: 1, action: 'research', names: ['../escape'] },
    {
      version: 1,
      action: 'prepare',
      packages: [{ name: 'three', version: 'file:../secret', reason: '' }],
    },
    {
      version: 1,
      action: 'prepare',
      packages: [],
      command: 'npm run arbitrary',
    },
    { version: 1, action: 'prepare', packages: [], upgrades: ['not-selected'] },
  ])
    assert.throws(() => parseDependencyRequest(request));
  assert.throws(() =>
    parseDependencyExchange(
      {
        version: 1,
        runId: 'other',
        sequence: 1,
        request: { version: 1, action: 'done', lockSha256: null },
      },
      'run',
      1,
    ),
  );
});
const prepared = {
  runId: 'preparation-run',
  taskId: 't',
  stage: 'unused',
  providerId: 'codex-cli',
  modelId: null,
  executable: { executable: 'unused', prefix: [] },
  prompt: 'unused',
};
test('all four providers complete the same scoped file exchange without requiring a registry/network tool', async () => {
  for (const providerId of [
    'codex-cli',
    'claude-cli',
    'gemini-cli',
    'grok-cli',
  ]) {
    let stage,
      calls = 0,
      closed = false;
    const executor = {
      async run(input, _signal, emit) {
        stage = input.stage;
        calls++;
        assert.equal(
          input.inputFiles['ideas/source.md'],
          '목숨 7개, 전투 금지',
        );
        const seq = JSON.parse(
          input.inputFiles['.ai/tasks/dependency-response.json'],
        ).sequence;
        await fs.writeFile(
          path.join(input.stage, `.ai/tasks/dependency-request-${seq}.json`),
          JSON.stringify({
            version: 1,
            runId: prepared.runId,
            sequence: seq,
            request: {
              version: 1,
              action: seq === 1 ? 'research' : 'done',
              ...(seq === 1 ? { names: ['three'] } : { lockSha256: null }),
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
    };
    const exchange = new AiDependencyFileExchange({
      prepared: { ...prepared, providerId },
      executor,
      inputs: { 'ideas/source.md': '목숨 7개, 전투 금지' },
      assertCurrent() {},
      log() {},
    });
    const close = exchange.close.bind(exchange);
    exchange.close = async () => {
      closed = true;
      await close();
    };
    assert.equal(
      await prepareGameDependencies(
        {
          runId: prepared.runId,
          engine: {
            async execute() {
              return { version: 1, action: 'research', packages: [] };
            },
          },
          exchange,
          assertCurrent() {},
          progress() {},
        },
        new AbortController().signal,
      ),
      null,
    );
    assert.equal(calls, 2);
    assert.equal(closed, true);
    await assert.rejects(fs.access(stage));
  }
});
test('missing preparation output reports the provider explanation and still cleans the isolated stage', async () => {
  let directory;
  const exchange = new AiDependencyFileExchange({
    prepared,
    inputs: { 'ideas/source.md': 'Keep this original' },
    executor: {
      async run(input, _signal, emit) {
        directory = input.stage;
        emit({
          stream: 'stdout',
          text:
            JSON.stringify({
              type: 'item.completed',
              item: {
                type: 'agent_message',
                text: 'Local file reader unavailable',
              },
            }) + '\n',
        });
        return { code: 0 };
      },
    },
    assertCurrent() {},
    log() {},
  });
  try {
    await assert.rejects(
      exchange.turn(1, null, new AbortController().signal),
      /요청 파일을 만들지 않았습니다.*Local file reader unavailable/,
    );
    assert.equal(
      await fs.readFile(path.join(directory, 'ideas/source.md'), 'utf8'),
      'Keep this original',
    );
    await assert.rejects(
      fs.access(path.join(directory, '.ai/tasks/dependency-request-1.json')),
    );
  } finally {
    await exchange.close();
  }
  await assert.rejects(fs.access(directory));
});
test('round bound, stale session, mismatched confirmation and provider terminal failures never publish a result', async () => {
  let closed = 0;
  const ports = {
    runId: 'run',
    engine: {
      async execute() {
        return { version: 1, action: 'research', packages: [] };
      },
    },
    exchange: {
      async turn(sequence) {
        return {
          version: 1,
          runId: 'run',
          sequence,
          request: { version: 1, action: 'research', names: ['three'] },
        };
      },
      async close() {
        closed++;
      },
    },
    assertCurrent() {},
    progress() {},
  };
  await assert.rejects(
    prepareGameDependencies(ports, new AbortController().signal),
    /3회/,
  );
  assert.equal(closed, 1);
  let valid = true;
  await assert.rejects(
    prepareGameDependencies(
      {
        ...ports,
        assertCurrent() {
          if (!valid) throw Error('stale session');
        },
        engine: {
          async execute() {
            valid = false;
            return { version: 1, action: 'research', packages: [] };
          },
        },
      },
      new AbortController().signal,
    ),
    /stale session/,
  );
  await assert.rejects(
    prepareGameDependencies(
      {
        ...ports,
        exchange: {
          ...ports.exchange,
          async turn(sequence) {
            return {
              version: 1,
              runId: 'run',
              sequence,
              request: {
                version: 1,
                action: 'done',
                lockSha256: 'a'.repeat(64),
              },
            };
          },
        },
      },
      new AbortController().signal,
    ),
    /일치/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(prepareGameDependencies(ports, controller.signal));
});
test('file exchange refuses source edits and undeclared outputs, including write-only executor input', async () => {
  for (const mode of ['modify', 'extra', 'missing-end']) {
    const exchange = new AiDependencyFileExchange({
      prepared: { ...prepared, providerId: 'grok-cli' },
      inputs: { 'ideas/source.md': 'original' },
      assertCurrent() {},
      log() {},
      executor: {
        async run(input, _signal, emit) {
          await fs.writeFile(
            path.join(input.stage, '.ai/tasks/dependency-request-1.json'),
            JSON.stringify({
              version: 1,
              runId: prepared.runId,
              sequence: 1,
              request: { version: 1, action: 'done', lockSha256: null },
            }),
          );
          if (mode === 'modify')
            await fs.writeFile(
              path.join(input.stage, 'ideas/source.md'),
              'changed',
            );
          if (mode === 'extra')
            await fs.writeFile(
              path.join(input.stage, 'game.html'),
              'not allowed',
            );
          if (mode !== 'missing-end')
            emit({
              stream: 'stdout',
              text: '{"type":"end","stopReason":"end_turn"}\n',
            });
          return { code: 0 };
        },
      },
    });
    try {
      await assert.rejects(
        exchange.turn(1, null, new AbortController().signal),
        mode === 'modify'
          ? /원본 입력/
          : mode === 'extra'
            ? /허용 범위/
            : /완료 이벤트/,
      );
    } finally {
      await exchange.close();
    }
  }
});

test('the application owns previous locks and upgrade consent, even when an AI omits or changes them', async () => {
  const lock = {
    version: 1,
    roots: { three: 'node_modules/three' },
    packages: [
      {
        key: 'node_modules/three',
        name: 'three',
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/three/-/three-1.0.0.tgz',
        integrity: `sha512-${'a'.repeat(86)}==`,
        dependencies: [],
        license: 'MIT',
      },
    ],
  };
  const requested = {
    version: 1,
    action: 'prepare',
    packages: [{ name: 'three', version: 'latest', reason: '3D rendering' }],
  };
  async function run(request, options = { previousLock: lock }) {
    const seen = [];
    const prepared = {
      version: 1,
      action: 'prepared',
      lock,
      lockSha256: 'b'.repeat(64),
    };
    const result = await prepareGameDependencies(
      {
        runId: 'run',
        ...options,
        assertCurrent() {},
        progress() {},
        engine: {
          async execute(item) {
            seen.push(item);
            return prepared;
          },
        },
        exchange: {
          async turn(sequence) {
            return {
              version: 1,
              runId: 'run',
              sequence,
              request:
                sequence === 1
                  ? request
                  : {
                      version: 1,
                      action: 'done',
                      lockSha256: prepared.lockSha256,
                    },
            };
          },
          async close() {},
        },
      },
      new AbortController().signal,
    );
    assert.equal(result.lockSha256, prepared.lockSha256);
    return seen[0];
  }
  const seen = await run(requested);
  assert.deepEqual(seen.previousLock, lock);
  assert.notEqual(seen.previousLock, lock);
  await assert.rejects(
    run({
      ...requested,
      previousLock: {
        ...lock,
        packages: [{ ...lock.packages[0], version: '2.0.0' }],
      },
    }),
    /바꿀 수/,
  );
  await assert.rejects(
    run({ ...requested, upgrades: ['three'] }),
    /요청하지 않은/,
  );
  await assert.rejects(
    run({ ...requested, previousLock: lock }, {}),
    /앱이 제공한/,
  );
  assert.deepEqual(
    (
      await run(
        { ...requested, upgrades: ['three'] },
        { previousLock: lock, allowedUpgrades: ['three'] },
      )
    ).upgrades,
    ['three'],
  );
});
