import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import matter from 'gray-matter';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { commandLabels } from '../src/collaboration-model.ts';
import { DEFAULT_TASK_INSTRUCTIONS } from '../src/task-instructions.ts';

const stateRoot = path.join(
  process.env.LOCALAPPDATA,
  'GameCanvas-InternetHost',
);
const runtime = JSON.parse(
  (await fs.readFile(path.join(stateRoot, 'runtime.json'), 'utf8')).replace(
    /^\uFEFF/,
    '',
  ),
);
const url = runtime.publicUrl;
assert.ok(/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(url));
// The key is captured in memory, never printed, put in command-line arguments,
// or written to reports. Only synthetic documents are sent through Cloudflare.
const creationKey = execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-Command',
    '$s = Import-Clixml -LiteralPath $env:GC_VERIFY_KEY_FILE; $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }',
  ],
  {
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      GC_VERIFY_KEY_FILE: path.join(stateRoot, 'creation-key.clixml'),
    },
  },
);
const clients = [];
const startedAt = Date.now();
const timings = [];
const sample = async (operation) => {
  const start = performance.now();
  const result = await operation();
  timings.push(performance.now() - start);
  return result;
};
const markdown = (id, type = 'idea') =>
  matter.stringify('Synthetic network verification only.\n', {
    id,
    title: id,
    type,
    status: 'draft',
    x: 80,
    y: 100,
    width: 340,
    height: 300,
    sources: [],
  });
const report = { publicUrl: url, syntheticDocumentsOnly: true, paidAiCalls: 0 };
try {
  const health = await (await fetch(`${url}/health`)).json();
  assert.equal(health.name, 'Game Canvas Collaboration');
  const unauthorized = await fetch(`${url}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(unauthorized.status, 403);
  await unauthorized.text();
  report.creationKeyProtection = true;
  const files = {
    'project.md': markdown('network-probe-project', 'project'),
    'output/index.html':
      '<!doctype html><html><body><h1>Network probe</h1></body></html>',
    ...Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [
        `ideas/probe-${index}.md`,
        markdown(`probe-${index}`),
      ]),
    ),
  };
  const created = await sample(() =>
    CollaborationClient.create(
      url,
      creationKey,
      'Network probe admin',
      `Internet probe ${new Date().toISOString()}`,
      files,
    ),
  );
  const owner = new CollaborationClient(created.credentials, () => {});
  owner.accept(created.result);
  clients.push(owner);
  for (let index = 0; index < 9; index++) {
    const joined = await sample(() =>
      CollaborationClient.join(
        url,
        created.result.code,
        `Network probe ${index + 1}`,
      ),
    );
    const client = new CollaborationClient(joined.credentials, () => {});
    client.accept(joined.result);
    clients.push(client);
  }
  const viewer = clients[9],
    editors = clients.slice(1, 9);
  await owner.setRole(viewer.state.memberId, 'viewer');
  await Promise.all(clients.map((client) => client.refresh()));
  assert.equal(owner.state.members.length, 10);
  assert.equal(viewer.state.role, 'viewer');
  await Promise.all(
    editors.map((editor, index) =>
      sample(async () => {
        const relativePath = `ideas/probe-${index}.md`;
        await editor.lock(relativePath);
        await editor.command('documents:save', {
          relativePath,
          title: `Network probe ${index}`,
          body: `공동 편집 확인 ${index} · 🐔`,
        });
        await editor.unlock(relativePath);
      }),
    ),
  );
  await owner.refresh();
  for (let index = 0; index < 8; index++)
    assert.ok(
      owner.files[`ideas/probe-${index}.md`].includes(
        `공동 편집 확인 ${index} · 🐔`,
      ),
    );
  report.simultaneousEditors = 8;
  await editors[0].lock('ideas/probe-0.md');
  await assert.rejects(owner.lock('ideas/probe-0.md'), /편집 중/);
  await editors[0].unlock('ideas/probe-0.md');
  report.exclusiveLockProtection = true;
  await assert.rejects(
    viewer.command('documents:update-layout', {
      relativePath: 'ideas/probe-0.md',
      x: 200,
      y: 200,
      width: 340,
      height: 300,
    }),
    /뷰어/,
  );
  await assert.rejects(
    editors[0].request('ai-start', {
      taskPath: '.ai/tasks/absent.md',
      revision: 1,
    }),
    /관리자/,
  );
  report.roleProtection = true;
  const history = await owner.history();
  const edits = history.filter(
    (entry) => entry.label === commandLabels['documents:save'],
  );
  assert.equal(edits.length, 8);
  assert.ok(
    edits.every((entry) => entry.actorId && entry.actorName && entry.createdAt),
  );
  report.attributedHistory = true;
  await viewer.refresh();
  assert.equal(viewer.files['output/index.html'], files['output/index.html']);
  report.htmlFileSync = true;
  assert.equal(owner.state.taskInstructionsEditable, true);
  for (const kind of ['organize', 'implement']) {
    const instructions = `추가 지시 수신 확인 · ${kind} · 🐔\n선택 자료만 사용하고 설명을 간단히 작성하세요.`;
    const task = await owner.command('tasks:create', {
      kind,
      inputPaths: ['ideas/probe-0.md'],
      x: 0,
      y: 0,
      instructions,
      documentResult: { mode: 'new' },
      htmlResult: { mode: 'new' },
    });
    await viewer.refresh();
    const specification = matter(viewer.files[task.relativePath]);
    assert.equal(specification.data.instructions_source, 'edited');
    assert.ok(specification.content.includes(instructions));
    assert.ok(!specification.content.includes(DEFAULT_TASK_INSTRUCTIONS[kind]));
    assert.ok(specification.content.includes('## 고정 보호 규칙'));
  }
  report.editableInstructionsSync = true;
  // Actual HTTPS polling through Cloudflare, not mocked clients or localhost.
  const until = Date.now() + 25_000;
  let rounds = 0;
  while (Date.now() < until) {
    await Promise.all(clients.map((client) => sample(() => client.refresh())));
    rounds++;
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  assert.ok(clients.every((client) => client.state.connected));
  report.authenticatedClients = 10;
  report.pollRounds = rounds;
  report.pollRequests = rounds * 10;
  report.sameDesktopThroughPublicTunnel = true;
  report.otherPhysicalPcVerified = false;
  report.elapsedMs = Date.now() - startedAt;
  timings.sort((a, b) => a - b);
  report.timingMs = {
    median: Math.round(timings[Math.floor(timings.length * 0.5)]),
    p95: Math.round(timings[Math.floor(timings.length * 0.95)]),
    max: Math.round(timings.at(-1)),
  };
  await fs.mkdir('out/qa', { recursive: true });
  await fs.writeFile(
    'out/qa/internet-host-verification.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await Promise.all(clients.map((client) => client.leave()));
}
