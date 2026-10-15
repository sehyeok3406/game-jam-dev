import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import test from 'node:test';
import matter from '../src/markdown.ts';
import { createTaskPlan, workflowStages } from '../src/task-plan.ts';
import { gamejamTaskInput } from '../src/gamejam-request.ts';
import { validateHtmlAnalysis } from '../src/html-source.ts';
import { validateArtifacts } from '../src/ai-artifacts.ts';
import { multiplayerIntent } from '../src/multiplayer/intent.ts';
import { usesIndependentConnection } from '../src/multiplayer/compatibility.ts';
import { multiplayerRepairRequest } from '../src/multiplayer/repair-request.ts';
import { multiplayerInstructions } from '../src/multiplayer/generation.ts';
import { DEFAULT_MULTIPLAYER } from '../src/multiplayer/types.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { PlayClient } from '../src/multiplayer/client.ts';

// Captured from the user's failing request, rather than a handwritten SDK game.
const failed = fs.readFileSync(
  new URL('./fixtures/user-multiplayer-result.html', import.meta.url),
  'utf8',
);
const idea = fs.readFileSync(
  new URL('./fixtures/user-multiplayer-request.md', import.meta.url),
  'utf8',
);
const path = 'output/inbox/user-game/v001/index.html';
const files = {
  'project.md': matter.stringify('Project', {
    id: 'project',
    title: 'Project',
    type: 'idea',
    status: 'draft',
    sources: [],
  }),
  'ideas/user.md': matter.stringify(idea, {
    id: 'user-idea',
    title: '멀티 테스트',
    type: 'idea',
    status: 'draft',
    sources: [],
  }),
  [path]: failed,
};
const plain = (instructions, extras = {}) => ({
  kind: 'implement',
  instructions,
  inputPaths: ['ideas/user.md'],
  x: 0,
  y: 0,
  resultName: '사용자 게임',
  htmlResult: { mode: 'new' },
  ...extras,
});

test('the actual text-only user request resolves app multiplayer without a library selection', () => {
  const request = gamejamTaskInput({
    organize: false,
    implement: true,
    inputPaths: ['ideas/user.md'],
    x: 0,
    y: 0,
    resultName: '멀티 테스트',
    instructions: { organize: '', implement: '선택한 메모로 게임을 만들어줘.' },
  });
  assert.equal(request.multiplayer, undefined);
  const plan = createTaskPlan(request, 'user-text', files);
  const data = matter(plan).data;
  assert.deepEqual(data.multiplayer, DEFAULT_MULTIPLAYER);
  assert.match(plan, /GameJamMultiplayer.register/);
  const target = data.expected_outputs[0];
  assert.throws(
    () =>
      validateHtmlAnalysis(
        plan,
        { ...files, [target]: '<body>멀티를 구현했어요</body>' },
        [target],
      ),
    /GC-MP-001/,
  );
  assert.throws(
    () =>
      validateArtifacts(
        files,
        { ...files, [target]: failed + '\n<!-- regenerated -->' },
        [target],
      ),
    /GC-MP-030/,
  );
});

test('plain instructions and two-stage workflows retain online intent, counts and removal', () => {
  const empty = { ...files, 'ideas/user.md': files['project.md'] };
  const three = createTaskPlan(
    plain('온라인으로 3명이 함께 플레이하게 만들어줘.'),
    'three',
    empty,
  );
  assert.equal(matter(three).data.multiplayer.maxPlayers, 3);
  const workflow = createTaskPlan(
    {
      ...plain('정리해줘.'),
      kind: 'organize',
      thenImplement: {
        instructions: '4인 온라인 협동으로 만들어줘.',
        htmlResult: { mode: 'new' },
      },
    },
    'two-stage',
    empty,
  );
  assert.equal(
    matter(workflowStages(workflow)[1]).data.multiplayer.maxPlayers,
    4,
  );
  assert.equal(
    matter(
      createTaskPlan(
        plain('멀티를 제거하고 혼자 플레이하게 해줘.'),
        'remove',
        files,
      ),
    ).data.multiplayer,
    null,
  );
  assert.equal(
    matter(
      createTaskPlan(
        plain('온라인 8명', { multiplayer: null }),
        'explicit',
        files,
      ),
    ).data.multiplayer,
    null,
  );
  assert.equal(
    matter(
      createTaskPlan(
        plain('온라인 4명', { multiplayer: DEFAULT_MULTIPLAYER }),
        'explicit-two',
        files,
      ),
    ).data.multiplayer.maxPlayers,
    2,
  );
});

test('ordinary and same-PC games stay local, with conditional SDK guidance for ambiguous language', () => {
  for (const text of [
    '1P 2P 고르고 이동하는 게임',
    '멀티샷 아이템을 추가해줘.',
    '한 PC에서 로컬 멀티플레이를 만들어줘.',
  ])
    assert.ok(!multiplayerIntent(text));
  assert.equal(multiplayerIntent('온라인 멀티를 제거해줘.'), null);
  assert.equal(
    multiplayerIntent('온라인 연결 설정 입력을 없애고 앱 멀티로 바꿔줘.')
      .maxPlayers,
    2,
  );
  assert.equal(multiplayerIntent('싱글 게임으로 바꿔줘.'), null);
  assert.equal(
    multiplayerIntent('온라인 4명. 온라인 방에서 기다려줘.').maxPlayers,
    4,
  );
  assert.throws(() => multiplayerIntent('온라인 8명 게임'), /2~4명/);
  const empty = { ...files, 'ideas/user.md': files['project.md'] };
  const plan = createTaskPlan(
    plain('혼자 점프하는 게임을 만들어줘.'),
    'solo',
    empty,
  );
  assert.equal(matter(plan).data.multiplayer, undefined);
  assert.match(plan, /온라인 요구가 없거나 같은 PC/);
  assert.match(
    multiplayerInstructions(undefined),
    /기능 라이브러리 선택은 필요하지 않다/,
  );
});

test('connection checks inspect executable JS, including deferred buttons, without flagging documentation', () => {
  assert.equal(usesIndependentConnection(failed), true);
  for (const script of [
    '()=>new RTCPeerConnection({})',
    "()=>new window['RTCPeerConnection']({})",
    '()=>new WebSocket("wss://example.invalid")',
  ]) {
    assert.equal(
      usesIndependentConnection(
        `<body><script>const connect=${script};</script></body>`,
      ),
      true,
    );
  }
  assert.equal(
    usesIndependentConnection(
      '<button onclick="new RTCPeerConnection({})">연결</button>',
    ),
    true,
  );
  assert.equal(
    usesIndependentConnection(
      '<body>RTCPeerConnection<script>// new RTCPeerConnection()\nconst help="new WebSocket()";</script><script type="application/json">{"help":"new RTCPeerConnection()"}</script></body>',
    ),
    false,
  );
});

test('the existing user game enters the normal repair pipeline without replacing its source', () => {
  const request = multiplayerRepairRequest(
    path,
    '사용자 게임',
    'default',
    10,
    20,
  );
  assert.equal(request.htmlResult.mode, 'new');
  assert.equal(request.htmlResult.basePath, path);
  assert.deepEqual(request.inputPaths, [path]);
  const plan = createTaskPlan(
    gamejamTaskInput(request),
    'repair-user-game',
    files,
  );
  const data = matter(plan).data;
  assert.ok(data.expected_outputs.every((target) => target !== path));
  assert.ok(data.inputs.includes(path));
  assert.match(plan, /규칙·화면·조작·콘텐츠를 유지/);
  assert.equal(files[path], failed);
});

test('the real server diagnoses the captured user game before waiting for a connection', async (t) => {
  const directory = await fs.promises.mkdtemp(
    nodePath.join(os.tmpdir(), 'gamejam-user-source-'),
  );
  const server = await createCollaborationServer({
    port: 0,
    dataDirectory: directory,
  });
  t.after(async () => {
    await server.close();
    await fs.promises.rm(directory, { recursive: true, force: true });
  });
  const created = await CollaborationClient.create(
    `http://127.0.0.1:${server.port}`,
    '',
    'User',
    'User regression',
    files,
  );
  await assert.rejects(
    PlayClient.control(created.credentials, {
      action: 'create',
      path,
      sourceHash: createHash('sha256').update(failed).digest('hex'),
      requestId: randomUUID(),
    }),
    (error) => error.code === 'GC-MP-030',
  );
});
