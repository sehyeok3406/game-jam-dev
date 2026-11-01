import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import {
  grokArguments,
  prepareGrokProcess,
} from '../src/adapters/node/ai/grok.ts';
import { collectProcess } from '../src/desktop/ai/process-runner.ts';
import { ProviderRunOutput } from '../src/adapters/node/ai/run-output.ts';

// Opt in with an official local binary. All model responses come from localhost;
// no real API key, login, paid inference, or external message is used.
test(
  'official Grok CLI uses file tools and refuses traversal with a local synthetic model',
  { skip: !process.env.GROK_TEST_EXECUTABLE, timeout: 45000 },
  async (t) => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'gamejam-grok-native-'),
    );
    const stage = path.join(root, 'workspace with spaces');
    await fs.mkdir(stage);
    await fs.writeFile(path.join(root, 'secret.txt'), 'PRIVATE-SENTINEL');
    const command = {
      executable: process.env.GROK_TEST_EXECUTABLE,
      prefix: [],
    };
    const prepared = await prepareGrokProcess(
      command,
      collectProcess,
      stage,
      'Write the requested file.',
      {
        'ideas/source.md': 'NATIVE-FROZEN-CONTEXT',
        'assets/images/native.png':
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGL538AAAAAA///5tjreAAAABklEQVQDAAQRAYTXKkMGAAAAAElFTkSuQmCC',
      },
    );
    let child;
    const requests = [];
    let calls = 0;
    let attack = null;
    const server = http.createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      if (req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            data: [{ id: 'fixture', object: 'model', context_window: 256000 }],
          }),
        );
        return;
      }
      const body = JSON.parse(raw);
      requests.push(body);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const offered = (body.tools ?? []).map(
        (tool) => tool.function?.name ?? tool.name,
      );
      const tool = offered.find((name) => name === 'write');
      const write = {
        file_path: 'result.txt',
        path: 'result.txt',
        content: '한글 결과',
      };
      const read = {
        target_file: '../secret.txt',
        should_read_entire_file: true,
      };
      const outsideWrite = {
        file_path: '../escaped.txt',
        path: '../escaped.txt',
        content: 'MUST-NOT-WRITE',
      };
      const readTool = 'read_file'; // Deliberately request an unavailable tool.
      const sequence = [{ name: tool, args: write }];
      if (attack)
        sequence.push(
          attack === 'read'
            ? { name: readTool, args: read }
            : { name: tool, args: outsideWrite },
        );
      const planned = sequence[calls++];
      const delta = planned
        ? {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: `call_${calls}`,
                type: 'function',
                function: {
                  name: planned.name ?? 'missing-file-tool',
                  arguments: JSON.stringify(planned.args),
                },
              },
            ],
          }
        : { role: 'assistant', content: '완료' };
      res.write(
        'data: ' +
          JSON.stringify({
            id: 'fixture-' + calls,
            created: 1,
            object: 'chat.completion.chunk',
            model: 'fixture',
            choices: [{ index: 0, delta, finish_reason: null }],
          }) +
          '\n\n',
      );
      res.write(
        'data: ' +
          JSON.stringify({
            id: 'fixture-' + calls,
            created: 1,
            object: 'chat.completion.chunk',
            model: 'fixture',
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: planned ? 'tool_calls' : 'stop',
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }) +
          '\n\n',
      );
      res.end('data: [DONE]\n\n');
    });
    t.after(async () => {
      if (child && child.exitCode === null) child.kill();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await prepared.cleanup();
      assert.ok(
        path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep),
      );
      await fs.rm(root, { recursive: true, force: true });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/v1`;
    await fs.appendFile(
      path.join(prepared.env.GROK_HOME, 'config.toml'),
      `\n[model.fixture]\nmodel = "fixture"\nbase_url = "${base}"\nenv_key = "XAI_API_KEY"\napi_backend = "chat_completions"\ncontext_window = 256000\n`,
    );
    const env = {
      ...prepared.env,
      XAI_API_KEY: 'local-fixture-only',
      GROK_AUTH_PATH: path.join(root, 'no-credentials.json'),
      GROK_XAI_API_BASE_URL: base,
      GROK_MODELS_LIST_URL: base + '/models',
    };
    for (const scenario of [null, 'read', 'write']) {
      attack = scenario;
      calls = 0;
      requests.length = 0;
      const output = new ProviderRunOutput('grok-cli', () => {});
      let stdout = '',
        stderr = '';
      child = spawn(
        command.executable,
        [
          '--prompt-file',
          prepared.promptFile,
          ...grokArguments('fixture', stage),
          '--max-turns',
          '6',
        ],
        {
          cwd: stage,
          env,
          windowsHide: true,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      child.stdout.setEncoding('utf8').on('data', (text) => {
        stdout += text;
        output.consume({ stream: 'stdout', text });
      });
      child.stderr.setEncoding('utf8').on('data', (text) => {
        stderr += text;
      });
      const timer = setTimeout(() => child.kill(), 35000);
      const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      clearTimeout(timer);
      assert.equal(code, 0, stdout + '\n' + stderr);
      output.flush();
      if (scenario === 'write') assert.ok(output.failure, stdout);
      else assert.equal(output.failure, '', stdout);
      assert.equal(
        await fs.readFile(path.join(stage, 'result.txt'), 'utf8'),
        '한글 결과',
        stdout,
      );
      await assert.rejects(fs.access(path.join(root, 'escaped.txt')));
      assert.equal(
        JSON.stringify(requests).includes('PRIVATE-SENTINEL'),
        false,
      );
      assert.ok(calls >= 2, stdout);
      const tools = requests[0].tools.map(
        (tool) => tool.function?.name ?? tool.name,
      );
      assert.deepEqual(tools, ['write']);
      assert.ok(JSON.stringify(requests[0]).includes('NATIVE-FROZEN-CONTEXT'));
      assert.ok(
        JSON.stringify(requests[0]).includes(
          'gamecanvas-asset:assets/images/native.png',
        ),
      );
    }
  },
);
