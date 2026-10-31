import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  GROK_FILE_TOOLS,
  grokArguments,
  grokPrompt,
  grokEnvironment,
  grokVersionSupported,
  assertGrokInspection,
  prepareGrokProcess,
} from '../src/adapters/node/ai/grok.ts';
import { ProviderRunOutput } from '../src/adapters/node/ai/run-output.ts';
import { NodeAiExecutor } from '../src/desktop/ai/node-executor.ts';
import {
  supportsSharedAiProvider,
  reasoningError,
} from '../src/core/ai/catalog.ts';
import {
  readSavedRequest,
  loadGamejamDraft,
  saveGamejamDraft,
} from '../src/gamejam-history.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';

const inspection = (home) => ({
  hooks: [],
  skills: [],
  plugins: [],
  mcpServers: [],
  lspServers: [],
  projectInstructions: [],
  permissions: { sources: [] },
  configSources: { layers: [{ path: path.join(home, 'config.toml') }] },
});

test('Grok only grants workspace file tools, omits unsupported reasoning, and never grants bypass or external tools', () => {
  const args = grokArguments('custom-model', 'C:/workspace with spaces');
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.deepEqual(
    args[args.indexOf('--tools') + 1].split(','),
    GROK_FILE_TOOLS,
  );
  assert.ok(args.includes('Write(./**)'));
  for (const rule of [
    'Read',
    'Grep',
    'Bash',
    'MCPTool',
    'WebFetch',
    'WebSearch',
  ])
    assert.ok(args.some((v, i) => v === '--deny' && args[i + 1] === rule));
  assert.ok(!args.includes('--always-approve'));
  assert.ok(!args.includes('--sandbox')); // No unsupported claim of an OS sandbox on Windows.
  assert.equal(
    reasoningError('grok-cli', 'custom-model', 'high') !== null,
    true,
  );
  assert.equal(grokVersionSupported('grok 1.0.70 (abc)'), true);
  assert.equal(grokVersionSupported('grok 1.1.0'), true);
  for (const version of ['grok 1.0.69', 'fixture 1.0.70', 'grok 1.0.70-beta'])
    assert.equal(grokVersionSupported(version), false);
});

test('temporary Grok settings reuse the credential path without copying secrets or inheriting executable settings', () => {
  const source = {
    GROK_HOME: 'C:/personal-grok',
    GROK_CONFIG: 'secret config',
    GROK_AUTH: 'secret token',
    GROK_AUTH_PROVIDER_COMMAND: 'run-command',
    GROK_SANDBOX: 'off',
    XAI_API_KEY: 'key',
    PATH: 'path',
  };
  const env = grokEnvironment('C:/isolated', source);
  assert.equal(env.GROK_HOME, 'C:/isolated');
  assert.equal(env.GROK_AUTH_PATH, path.resolve('C:/personal-grok/auth.json'));
  assert.equal(env.XAI_API_KEY, 'key');
  assert.equal(env.GROK_CONFIG, undefined);
  assert.equal(env.GROK_AUTH, undefined);
  assert.equal(env.GROK_AUTH_PROVIDER_COMMAND, undefined);
  assert.equal(env.GROK_DISABLE_AUTOUPDATER, '1');
  assert.equal(env.GROK_CLAUDE_HOOKS_ENABLED, '0');
  assert.equal(source.GROK_CONFIG, 'secret config');
});

test('inspection fails closed on inherited code, rules, missing schema and foreign config layers', () => {
  const home = path.resolve('fixture-home');
  assert.doesNotThrow(() => assertGrokInspection(inspection(home), home));
  for (const key of [
    'hooks',
    'skills',
    'plugins',
    'mcpServers',
    'lspServers',
    'projectInstructions',
  ]) {
    const report = inspection(home);
    report[key] = [{ source: 'outside' }];
    assert.throws(() => assertGrokInspection(report, home), /외부 설정/);
  }
  const rules = inspection(home);
  rules.permissions.sources.push('global');
  assert.throws(() => assertGrokInspection(rules, home), /권한/);
  const config = inspection(home);
  config.configSources.layers.push({ path: '/external/config.toml' });
  assert.throws(() => assertGrokInspection(config, home), /계층/);
  assert.throws(() => assertGrokInspection({}, home));
});

test('Grok prompt carries frozen text and image content without asking the CLI to read files', () => {
  const blocks = grokPrompt('Fixed protection rules', {
    '.ai/tasks/task.md': 'task specification',
    'ideas/source.md': 'untrusted source',
    'assets/images/player.png': 'data:image/png;base64,AQID',
  });
  assert.match(blocks[0].text, /only the write tool/);
  assert.match(blocks[0].text, /task specification/);
  assert.match(blocks[0].text, /untrusted source/);
  assert.match(blocks[0].text, /gamecanvas-asset:assets\/images\/player.png/);
  assert.deepEqual(blocks[1], {
    type: 'image',
    mimeType: 'image/png',
    data: 'AQID',
  });
});

test('failed preparation removes temporary config and never exposes an invalid inspector payload', async () => {
  let home;
  await assert.rejects(
    prepareGrokProcess(
      { executable: 'fixture', prefix: [] },
      async (_cmd, args, _timeout, options) => {
        assert.deepEqual(args, ['inspect', '--json']);
        home = options.env.GROK_HOME;
        assert.equal(options.cwd, home);
        return { code: 0, stdout: 'secret-token-invalid-json', stderr: '' };
      },
    ),
    (error) =>
      /검사 응답/.test(error.message) &&
      !error.message.includes('secret-token'),
  );
  await assert.rejects(fs.access(home));
});

test('native Grok deltas are joined and only a normal terminal end succeeds; EOF, errors and turn limits fail', () => {
  const emitted = [];
  const output = new ProviderRunOutput('grok-cli', (kind, message) =>
    emitted.push({ kind, message }),
  );
  const send = (event) =>
    output.consume({ stream: 'stdout', text: JSON.stringify(event) + '\n' });
  send({ type: 'text', data: '한' });
  send({ type: 'text', data: '글 결과' });
  send({ type: 'thought', data: 'not a final answer' });
  send({ type: 'tool_call', toolName: 'write_file' });
  send({ type: 'end', stopReason: 'end_turn' });
  output.flush();
  assert.equal(output.lastMessage, '한글 결과');
  assert.equal(output.failure, '');
  assert.equal(emitted.filter((e) => e.kind === 'result').length, 1);
  assert.equal(
    emitted.some((e) => e.message.includes('not a final answer')),
    false,
  );
  for (const events of [
    [],
    [{ type: 'end', stopReason: 'max_tokens' }],
    [{ type: 'max_turns_reached' }, { type: 'end', stopReason: 'end_turn' }],
    [{ type: 'error', message: 'quota' }],
  ]) {
    output.reset();
    events.forEach(send);
    output.flush();
    assert.ok(output.failure);
  }
});

test('new provider capability has conservative legacy fallback and blocks every client start route before transport', async () => {
  assert.equal(supportsSharedAiProvider({}, 'codex-cli'), true);
  assert.equal(supportsSharedAiProvider({}, 'claude-cli'), false);
  assert.equal(
    supportsSharedAiProvider({ multiProviderAi: true }, 'gemini-cli'),
    true,
  );
  assert.equal(
    supportsSharedAiProvider({ multiProviderAi: true }, 'grok-cli'),
    false,
  );
  assert.equal(
    supportsSharedAiProvider(
      { supportedAiProviders: ['grok-cli'] },
      'grok-cli',
    ),
    true,
  );
  assert.equal(
    supportsSharedAiProvider({ supportedAiProviders: [] }, 'codex-cli'),
    false,
  );
  const client = new CollaborationClient(
    {
      serverUrl: 'http://127.0.0.1:1',
      projectId: '00000000-0000-0000-0000-000000000001',
      token: 'fixture',
    },
    () => {},
  );
  client.state = {
    ...client.state,
    connected: true,
    active: true,
    role: 'admin',
    multiProviderAi: true,
    aiQueueVersion: 1,
  };
  client.request = () =>
    assert.fail('unsupported provider must not reach transport');
  await assert.rejects(
    client.beginAi('task', null, 'grok-cli'),
    /서버를 업데이트/,
  );
  for (const approval of [undefined, { id: 'approval', revision: 1 }])
    await assert.rejects(
      client.enqueueAi({
        taskPath: 'task',
        providerId: 'grok-cli',
        modelId: null,
        approval,
      }),
      /서버를 업데이트/,
    );
});

test('Grok drafts survive save and restore using the common provider validator', () => {
  const snapshot = {
    version: 1,
    providerId: 'grok-cli',
    modelId: '',
    request: {
      organize: true,
      implement: false,
      inputPaths: [],
      x: 0,
      y: 0,
      resultName: '',
      instructions: { organize: '', implement: '' },
    },
  };
  assert.equal(readSavedRequest(snapshot).providerId, 'grok-cli');
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
  saveGamejamDraft(storage, 'fixture', {
    ...snapshot,
    page: 1,
    instructionPage: 'organize',
    updatedAt: 1,
  });
  assert.equal(loadGamejamDraft(storage, 'fixture').providerId, 'grok-cli');
});

async function processFixture(t, hold = false) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-grok-executor-'),
  );
  const executor = new NodeAiExecutor('grok-cli');
  t.after(async () => {
    await executor.cancel('fixture');
    assert.ok(
      path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep),
    );
    await fs.rm(root, { recursive: true, force: true });
  });
  const script = path.join(root, 'cli.cjs');
  await fs.writeFile(
    script,
    `const fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2);if(args[0]==='inspect'){console.log(JSON.stringify(${JSON.stringify(inspection('__HOME__'))}).replaceAll('__HOME__',process.env.GROK_HOME.replaceAll('\\\\','/')));process.exit(0);}const promptFile=args[args.indexOf('--prompt-file')+1];fs.writeFileSync('received.json',JSON.stringify({prompt:fs.readFileSync(promptFile,'utf8'),promptFile,args,cwd:process.cwd(),home:process.env.GROK_HOME}));${hold ? "console.log('READY');setInterval(()=>{},1000);" : "const line=Buffer.from(JSON.stringify({type:'text',data:'한글 결과'})+'\\n');const cut=line.indexOf(Buffer.from('한'))+1;process.stdout.write(line.subarray(0,cut));setTimeout(()=>{process.stdout.write(line.subarray(cut));console.log(JSON.stringify({type:'end',stopReason:'end_turn'}));},10);"}`,
  );
  return {
    root,
    executor,
    input: {
      runId: 'fixture',
      taskId: 'task',
      stage: root,
      providerId: 'grok-cli',
      modelId: null,
      prompt: '긴 한글 보호 지시 '.repeat(4000),
      executable: { executable: process.execPath, prefix: [script] },
    },
  };
}

test(
  'real process adapter passes long UTF-8 prompt by file, cleans temporary settings and parses native output',
  { timeout: 15000 },
  async (t) => {
    const { root, executor, input } = await processFixture(t);
    const output = new ProviderRunOutput('grok-cli', () => {});
    const result = await executor.run(
      input,
      new AbortController().signal,
      (event) => output.consume(event),
    );
    assert.equal(result.error, undefined);
    assert.equal(result.code, 0);
    output.flush();
    assert.equal(output.lastMessage, '한글 결과');
    const received = JSON.parse(
      await fs.readFile(path.join(root, 'received.json')),
    );
    assert.equal(received.prompt, input.prompt);
    assert.equal(
      received.args.some((arg) => arg.includes(input.prompt)),
      false,
    );
    assert.equal(path.resolve(received.cwd), path.resolve(root));
    await assert.rejects(fs.access(received.home));
  },
);

test(
  'Grok cancellation kills the process and removes private prompt files',
  { timeout: 15000 },
  async (t) => {
    const { root, executor, input } = await processFixture(t, true);
    const controller = new AbortController();
    let ready;
    const started = new Promise((resolve) => {
      ready = resolve;
    });
    const running = executor.run(input, controller.signal, (event) => {
      if (event.text.includes('READY')) ready();
    });
    await started;
    controller.abort();
    await executor.cancel(input.runId);
    assert.notEqual((await running).code, 0);
    const received = JSON.parse(
      await fs.readFile(path.join(root, 'received.json')),
    );
    await assert.rejects(fs.access(received.home));
  },
);
