import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  root,
  profile,
  game,
  boot,
  stop,
  wait,
  js,
  send,
} from './helpers/packaged-canvas.mjs';
import {
  DEFAULT_TASK_INSTRUCTIONS,
  LEGACY_TASK_INSTRUCTIONS_V1,
} from '../src/core/ai/instruction-templates.ts';
import { gamejamTaskInput } from '../src/gamejam-request.ts';
import { saveHistory, projectPath } from '../src/project-store.ts';
import { workflowStages } from '../src/task-plan.ts';
import { requestSnapshotFromTask } from '../src/gamejam-history.ts';
import { taskInstructionContract } from '../src/task-instruction-contract.ts';

const call = (method, ...args) =>
  js(
    `window.gameCanvas[${JSON.stringify(method)}](...${JSON.stringify(args)})`,
  );
const pause = () => new Promise((resolve) => setTimeout(resolve, 80));
async function click(selector, text) {
  await js(
    `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.textContent.includes(${JSON.stringify(text)})).click()`,
  );
  await pause();
}
async function open() {
  await wait(`!!document.querySelector('.document-card')`);
  await wait(`!!document.querySelector('[aria-label="gamejam!"]')`);
  await js(`document.querySelector('[aria-label="gamejam!"]').click()`);
  await wait('!!document.querySelector(".ai-request-dialog")');
}
const close = () =>
  js(`document.querySelector('[title="AI 실행창 닫기"]').click()`);
async function setInstructions(value) {
  await js(
    `{const e=document.querySelector('#ai-task-instructions-organize');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));}`,
  );
  await pause();
}
const request = (instructions) => ({
  organize: true,
  implement: true,
  inputPaths: ['project.md'],
  x: 1,
  y: 2,
  resultName: '지침 보존 검사',
  documentResult: {
    mode: 'new',
    structure: 'custom',
    documents: [
      {
        key: 'd1',
        title: '예전 구성 유지',
        type: 'overview',
        instructions: '사용자가 선택한 한 문서 구성을 유지한다.',
      },
    ],
  },
  htmlResult: { mode: 'new' },
  instructions,
});
async function record(id, instructions, createdAt) {
  await saveHistory(
    game,
    {},
    {},
    {
      id,
      label: '이전 요청',
      kind: 'ai',
      status: 'failed',
      createdAt,
      providerId: 'codex-cli',
      modelId: null,
      aiTask: {
        title: '이전 요청',
        specification: 'history fixture',
        origin: 'snapshot',
        inputs: ['project.md'],
        outputs: [],
        requestSnapshot: {
          version: 1,
          providerId: 'codex-cli',
          modelId: '',
          request: request(instructions),
        },
      },
    },
  );
}
const currentDraft = () =>
  js(
    `Object.keys(localStorage).filter(k=>k.startsWith('game-canvas-gamejam-draft:')).map(k=>JSON.parse(localStorage.getItem(k))).sort((a,b)=>b.updatedAt-a.updatedAt)[0]`,
  );
try {
  await record('old-default', { ...LEGACY_TASK_INSTRUCTIONS_V1 }, 1);
  await boot(false);
  await js(`document.querySelector('.home-project-open')?.click()`);
  await open();
  await click('.gamejam-request-history button', '최근 작업 불러오기');
  await wait(
    `document.querySelector('#ai-task-instructions-organize')?.value===${JSON.stringify(DEFAULT_TASK_INSTRUCTIONS.organize)}`,
  );
  assert.equal(
    (await currentDraft()).request.documentResult.documents.length,
    1,
  );
  assert.equal(
    (await currentDraft()).request.instructionOrigins.implement.templateVersion,
    2,
  );
  assert.deepEqual(
    (await call('listHistory')).find((h) => h.id === 'old-default').aiTask
      .requestSnapshot.request.instructions,
    LEGACY_TASK_INSTRUCTIONS_V1,
  );
  await close();
  const custom =
    '사용자 조건: 목숨은 7개, 전투 금지.\n최신 기본값과 비교해도 이 문장을 보존한다.';
  await record(
    'old-custom',
    { organize: custom, implement: '밤의 숲과 하단 HUD를 구현.' },
    2,
  );
  await open();
  await click('.gamejam-request-history button', '최근 작업 불러오기');
  await wait(
    `document.querySelector('#ai-task-instructions-organize')?.value===${JSON.stringify(custom)}`,
  );
  assert.equal(
    (await currentDraft()).request.instructionOrigins.organize.source,
    'legacy',
  );
  await click('.ai-request-dialog > footer button', '다음');
  await click('.ai-request-dialog > footer button', '다음');
  await wait(
    `!!document.querySelector('[data-gamejam-page="3"]:not([hidden])')`,
  );
  await js(
    `document.querySelector('.gamejam-instructions:not([hidden]) .ai-instructions-default').open=true`,
  );
  assert.ok(
    await js(
      `document.querySelector('.gamejam-instructions:not([hidden]) .ai-instructions-review').textContent.includes('보존')`,
    ),
  );
  assert.equal(
    await js(`document.querySelector('#ai-task-instructions-organize').value`),
    custom,
  );
  const edited = custom + '\n사용자가 추가 편집한 내용.';
  await setInstructions(DEFAULT_TASK_INSTRUCTIONS.organize);
  assert.equal(
    await js(
      `document.querySelector('.gamejam-instructions:not([hidden]) .ai-instructions-heading button').disabled`,
    ),
    false,
  );
  await click(
    '.gamejam-instructions:not([hidden]) .ai-instructions-heading button',
    '기본값으로 복원',
  );
  assert.equal(
    (await currentDraft()).request.instructionOrigins.organize.source,
    'default',
  );
  await setInstructions(edited);
  await wait(
    `Object.keys(localStorage).filter(k=>k.startsWith('game-canvas-gamejam-draft:')).some(k=>JSON.parse(localStorage.getItem(k)).request.instructions.organize===${JSON.stringify(edited)})`,
  );
  assert.equal(
    (await currentDraft()).request.instructionOrigins.organize.source,
    'custom',
  );
  await js(
    `document.querySelector('.gamejam-instructions:not([hidden]) .ai-instructions-default').open=true`,
  );
  await send('Emulation.setDeviceMetricsOverride', {
    width: 680,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  });
  assert.ok(
    await js(
      `document.querySelector('.ai-request-fields').scrollWidth<=document.querySelector('.ai-request-fields').clientWidth`,
    ),
  );
  await fs.mkdir('out/game-build-stage2', { recursive: true });
  await fs.writeFile(
    'out/game-build-stage2/instruction-comparison.png',
    Buffer.from((await send('Page.captureScreenshot')).data, 'base64'),
  );
  await close();
  await stop(true);
  await boot(false);
  await js(`document.querySelector('.home-project-open')?.click()`);
  await open();
  await click('.gamejam-request-history button', '작성 중 요청 불러오기');
  assert.equal(
    await js(`document.querySelector('#ai-task-instructions-organize').value`),
    edited,
  );
  const draft = await currentDraft();
  await close();
  const task = await call(
    'createTask',
    gamejamTaskInput(draft.request, { providerId: 'codex-cli', modelId: '' }),
  );
  const raw = await fs.readFile(
    await projectPath(game, task.relativePath),
    'utf8',
  );
  const frozen = workflowStages(raw).map(
    (stage) => taskInstructionContract(stage).effective,
  );
  assert.equal(frozen[0].effectiveText, edited);
  assert.equal(frozen[1].effectiveText, '밤의 숲과 하단 HUD를 구현.');
  const layout = await call('getProjectLayout');
  await call('upgradeProjectLayout', layout.session);
  const migrated = await fs.readFile(
    await projectPath(game, task.relativePath),
    'utf8',
  );
  assert.deepEqual(
    workflowStages(migrated).map(
      (stage) => taskInstructionContract(stage).effective,
    ),
    frozen,
  );
  const internal = await call('startLocalCollaborationServer');
  await call('createCollaboration', {
    serverUrl: internal.serverUrl,
    serverKey: '',
    nickname: '지침 보존 관리자',
  });
  const next = requestSnapshotFromTask(migrated);
  const sharedTask = await call(
    'createTask',
    gamejamTaskInput(next.request, { providerId: 'codex-cli', modelId: '' }),
  );
  const histories = await call('listHistory'),
    history = histories.find((h) =>
      h.files.some((f) => f.relativePath === sharedTask.relativePath),
    );
  assert.ok(history);
  const sharedRaw = await call(
    'readHistoryFile',
    history.id,
    sharedTask.relativePath,
    'after',
  );
  assert.deepEqual(
    workflowStages(sharedRaw).map(
      (stage) => taskInstructionContract(stage).effective,
    ),
    frozen,
  );
  console.log(
    'PASS: actual Windows package upgrades known old defaults on reuse, preserves custom text/output choices/history, compares latest defaults without replacing text, restores a draft across restart, and freezes identical local/shared instruction context through layout migration; no AI calls',
  );
} catch (error) {
  console.error(
    'Packaged UI state:',
    await js(
      `({text:document.body.innerText.slice(-3500),url:location.href})`,
    ).catch(() => null),
  );
  throw error;
} finally {
  await stop();
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.equal(
    path.dirname(profile),
    path.resolve(process.env.APPDATA, 'Game Canvas', 'test-users'),
  );
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(profile, { recursive: true, force: true });
}
