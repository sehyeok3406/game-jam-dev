import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NodeAiExecutor } from '../src/desktop/ai/node-executor.ts';
async function fixture(t, hold = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-executor-'));
  let executor;
  t.after(async () => {
    await executor?.cancel('run-1');
    assert.ok(
      path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep),
    );
    await fs.rm(root, { recursive: true, force: true });
  });
  const script = path.join(root, 'mock-cli.cjs');
  await fs.writeFile(
    script,
    `const fs=require('node:fs');fs.writeFileSync('started.flag','started');let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>input+=s);process.stdin.on('end',()=>{if(${JSON.stringify(hold)}){console.log('READY');setInterval(()=>{},1000);return;}const b=Buffer.from(JSON.stringify({text:'한글 출력',input,argv:process.argv.slice(2),cwd:process.cwd()})+'\\n');const cut=b.indexOf(Buffer.from('한'))+1;process.stdout.write(b.subarray(0,cut));setTimeout(()=>{process.stdout.write(b.subarray(cut));process.stderr.write('진단 출력');},20);});`,
  );
  executor = new NodeAiExecutor('codex-cli');
  return {
    root,
    executor,
    input: {
      runId: 'run-1',
      taskId: 'task',
      stage: root,
      providerId: 'codex-cli',
      modelId: null,
      executable: { executable: process.execPath, prefix: [script] },
      prompt: '한글 입력',
    },
  };
}
test(
  'executor launches a real isolated mock CLI, preserves split UTF-8 and passes only existing restricted provider arguments',
  { timeout: 15000 },
  async (t) => {
    const { root, executor, input } = await fixture(t);
    const events = [];
    const result = await executor.run(
      input,
      new AbortController().signal,
      (event) => events.push(event),
    );
    assert.equal(result.code, 0);
    assert.equal(result.error, undefined);
    const stdout = events
      .filter((event) => event.stream === 'stdout')
      .map((event) => event.text)
      .join('');
    const payload = JSON.parse(stdout);
    assert.equal(payload.text, '한글 출력');
    assert.equal(payload.input, '한글 입력');
    assert.equal(path.resolve(payload.cwd), path.resolve(root));
    assert.ok(payload.argv.includes('--ignore-user-config'));
    assert.ok(payload.argv.includes('default_permissions=":workspace"'));
    assert.equal(
      events
        .filter((event) => event.stream === 'stderr')
        .map((event) => event.text)
        .join(''),
      '진단 출력',
    );
    assert.ok(!stdout.includes('\uFFFD'));
  },
);
test(
  'executor rejects duplicate run IDs and AbortSignal cancellation is idempotent; a cancelled task never starts another process',
  { timeout: 15000 },
  async (t) => {
    const { root, executor, input } = await fixture(t, true);
    const controller = new AbortController();
    let ready;
    const observed = new Promise((resolve) => (ready = resolve));
    const running = executor.run(input, controller.signal, (event) => {
      if (event.text.includes('READY')) ready();
    });
    await observed;
    await assert.rejects(
      executor.run(input, controller.signal, () => {}),
      /이미/,
    );
    controller.abort();
    const first = executor.cancel(input.runId),
      second = executor.cancel(input.runId);
    assert.equal(first, second);
    await first;
    assert.notEqual((await running).code, 0);
    await fs.rm(path.join(root, 'started.flag'));
    const cancelled = await executor.run(input, controller.signal, () =>
      assert.fail('aborted run must not emit process output'),
    );
    assert.equal(cancelled.code, null);
    assert.ok(cancelled.error);
    await assert.rejects(fs.access(path.join(root, 'started.flag')));
  },
);
