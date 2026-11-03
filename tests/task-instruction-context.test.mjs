import assert from 'node:assert/strict';
import { test } from 'node:test';
import matter from '../src/markdown.ts';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_TASK_INSTRUCTIONS,
  LEGACY_TASK_INSTRUCTIONS_V1,
  instructionTemplate,
} from '../src/core/ai/instruction-templates.ts';
import {
  prepareRequestInstructions,
  editRequestInstructions,
  freezeEffectiveInstructions,
  validateEffectiveInstructions,
} from '../src/core/ai/task-instructions.ts';
import { taskInstructionDigest as digest } from '../src/adapters/node/task-instruction-digest.ts';
import { taskInstructionContract } from '../src/task-instruction-contract.ts';
import { createTaskPlan, workflowStages } from '../src/task-plan.ts';
import { gamejamTaskInput } from '../src/gamejam-request.ts';
import {
  requestSnapshotFromTask,
  readSavedRequest,
} from '../src/gamejam-history.ts';
import { taskFileLock } from '../src/ai-file-lock.ts';
import { AiRunService } from '../src/application/ai/run-service.ts';
import { gameBuildCodec } from '../src/adapters/node/game-build-codec.ts';
import {
  defaultDocumentTemplates,
  taskDocumentFormat,
} from '../src/document-format.ts';
import { planProjectLayout } from '../src/application/projects/layout-migration.ts';
import { layoutMarkdownCodec } from '../src/adapters/markdown/layout-snapshot.ts';
import { remapLayoutMarkdown } from '../src/adapters/markdown/layout-links.ts';
import {
  relocateResults,
  remapResultChanges,
} from '../src/result-structure.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { reduceCollaboration } from '../src/collaboration-model.ts';

const idea = 'ideas/original.md',
  design = 'docs/design.md',
  taskPath = '.ai/tasks/context.md';
const files = {
  [idea]: matter.stringify(
    '# 원본 요구\n목숨은 정확히 7개. 무기는 추가하지 않는다. 배경은 밤의 숲.',
    { id: 'idea', title: '원본', type: 'idea' },
  ),
  [design]: matter.stringify(
    '# 설계\n탑다운 카메라, 하단 HUD, 피격 시 붉은 잔광.',
    {
      id: 'design',
      title: '설계',
      type: 'system',
      system_id: 'existing-design',
    },
  ),
  'output/index.html': '<!doctype html><html><body>old</body></html>',
};
const request = (instructions = { ...DEFAULT_TASK_INSTRUCTIONS }) => ({
  organize: true,
  implement: true,
  inputPaths: [idea, design],
  x: 1,
  y: 2,
  resultName: '',
  instructions,
  documentResult: {
    mode: 'new',
    structure: 'custom',
    documents: defaultDocumentTemplates(),
  },
  htmlResult: { mode: 'new' },
});

test('reuse upgrades only known untouched defaults, and restoring drafts/approvals keeps their exact text', () => {
  const old = request({ ...LEGACY_TASK_INSTRUCTIONS_V1 }),
    before = structuredClone(old);
  const renewed = prepareRequestInstructions(old, true);
  assert.deepEqual(renewed.updated, ['organize', 'implement']);
  assert.deepEqual(renewed.request.instructions, DEFAULT_TASK_INSTRUCTIONS);
  assert.deepEqual(old, before);
  const restored = prepareRequestInstructions(old, false);
  assert.deepEqual(restored.request.instructions, old.instructions);
  assert.equal(
    restored.request.instructionOrigins.implement.templateVersion,
    1,
  );
  assert.equal(
    prepareRequestInstructions(restored.request, true).request.instructions
      .implement,
    DEFAULT_TASK_INSTRUCTIONS.implement,
  );
  for (const mode of ['html', 'html-compose']) {
    const archived = instructionTemplate(
      mode === 'html' ? 'organize-html' : 'organize-html-compose',
      1,
    );
    const saved = {
      ...old,
      sourceMode: mode,
      instructions: { ...old.instructions, organize: archived },
    };
    const updated = prepareRequestInstructions(saved, true);
    assert.equal(
      updated.request.instructions.organize,
      instructionTemplate(
        mode === 'html' ? 'organize-html' : 'organize-html-compose',
      ),
    );
  }
});

test('explicit custom intent, edited legacy text and unknown provenance survive reuse with a review state', () => {
  let saved = prepareRequestInstructions(
    request({ ...LEGACY_TASK_INSTRUCTIONS_V1 }),
    false,
  ).request;
  saved = editRequestInstructions(
    saved,
    'implement',
    LEGACY_TASK_INSTRUCTIONS_V1.implement,
  );
  assert.equal(
    prepareRequestInstructions(saved, true).request.instructions.implement,
    LEGACY_TASK_INSTRUCTIONS_V1.implement,
  );
  for (const extra of [
    {},
    { instructionOrigins: { implement: { version: 99 } } },
  ]) {
    const custom = request({
      organize: '整理: 사용자 별도 지시',
      implement: '목숨 7개, 무기 금지.\n## 추가 조건',
    });
    Object.assign(custom, extra);
    const reused = prepareRequestInstructions(custom, true);
    assert.deepEqual(reused.request.instructions, custom.instructions);
    assert.deepEqual(reused.review, ['organize', 'implement']);
    assert.equal(reused.request.instructionOrigins.implement.source, 'legacy');
  }
  const reset = editRequestInstructions(
    saved,
    'implement',
    DEFAULT_TASK_INSTRUCTIONS.implement,
    true,
  );
  assert.equal(reset.instructionOrigins.implement.source, 'default');
  assert.equal(reset.instructionOrigins.implement.templateVersion, 2);
});

test('effective instructions store default/custom/application facts separately and reject corruption', () => {
  const custom = '원본 요구: 목숨 7개, 전투 금지.',
    frozen = freezeEffectiveInstructions(
      'implement',
      custom,
      undefined,
      undefined,
      digest,
    );
  assert.equal(frozen.defaultText, DEFAULT_TASK_INSTRUCTIONS.implement);
  assert.equal(frozen.userText, custom);
  assert.equal(frozen.effectiveText, custom);
  assert.equal(validateEffectiveInstructions(frozen, digest), frozen);
  for (const tamper of [
    { effectiveText: custom + '바꿈' },
    { defaultSha256: '0'.repeat(64) },
    { version: 99 },
    { templateVersion: 99 },
  ])
    assert.throws(() =>
      validateEffectiveInstructions({ ...frozen, ...tamper }, digest),
    );
  const old = freezeEffectiveInstructions(
    'implement',
    LEGACY_TASK_INSTRUCTIONS_V1.implement,
    undefined,
    undefined,
    digest,
  );
  assert.equal(old.templateVersion, 1);
  assert.equal(old.effectiveText, LEGACY_TASK_INSTRUCTIONS_V1.implement);
});

test('workflow preserves original instructions/materials, selected design and dynamic bounds without granting extra output paths', () => {
  const original = request({
    organize: '도구를 추가하지 말고 문서를 정리. 목숨은 7개, 무기는 금지.',
    implement: '밤의 숲을 구현한다.',
  });
  const raw = createTaskPlan(gamejamTaskInput(original), 'context', files);
  const steps = workflowStages(raw).map((stage) =>
    taskInstructionContract(stage),
  );
  assert.deepEqual(steps[1].context.originalInputs, original.inputPaths);
  assert.deepEqual(
    steps[1].context.originalInstructions,
    original.instructions,
  );
  assert.ok(steps[1].context.designDocuments.includes(design));
  assert.equal(matter(raw).data.gamejam_workflow_version, 2);
  const parsed = matter(raw),
    second = matter(parsed.data.workflow_steps[1]);
  second.data.inputs = second.data.inputs.filter((path) => path !== idea);
  parsed.data.workflow_steps[1] = matter.stringify(second.content, second.data);
  assert.throws(
    () => workflowStages(matter.stringify(parsed.content, parsed.data)),
    /원본 요구|작업 범위/,
  );
  const corrupted = matter(workflowStages(raw)[1]);
  corrupted.data.effective_instructions.effectiveText += 'bad';
  assert.throws(
    () =>
      taskInstructionContract(
        matter.stringify(corrupted.content, corrupted.data),
      ),
    /해시/,
  );
  assert.throws(() =>
    createTaskPlan(
      gamejamTaskInput({
        ...original,
        documentResult: {
          mode: 'update',
          structure: 'custom',
          baseDir: 'bundle:existing',
          documents: [],
        },
      }),
      'unsafe',
      files,
    ),
  );
});

function generated(raw) {
  const format = taskDocumentFormat(raw);
  return Object.fromEntries(
    format.documents.map((doc, index) => [
      doc.path,
      matter.stringify(
        '# 정리된 요약\n의도적으로 목숨 수치를 요약에서 빠뜨린 검사 자료.',
        {
          id: `generated-${index}`,
          title: doc.title,
          type: doc.type,
          status: 'draft',
          sources: ['idea', 'design'],
          document_bundle_id: format.id,
          document_output: { key: doc.key, instructions: doc.instructions },
          ...(doc.type === 'system'
            ? { system_id: `${format.id}:${doc.key}` }
            : {}),
        },
      ),
    ]),
  );
}
test('all four provider paths receive the original requirements even when the organized summary omits them', async () => {
  for (const provider of [
    'codex-cli',
    'claude-cli',
    'gemini-cli',
    'grok-cli',
  ]) {
    const original = request({
      organize: '목숨 7개, 무기 금지. 기획 문서로 정리.',
      implement: '선택한 설계를 게임으로 구현.',
    });
    const raw = createTaskPlan(gamejamTaskInput(original), provider, files),
      baseline = { ...files, [taskPath]: raw };
    let staged = { ...baseline };
    const workspace = {
      directory: '/isolated',
      capture: async () => ({ ...staged }),
      write: async (path, text) => {
        staged[path] = text;
      },
    };
    const service = new AiRunService(
      baseline,
      taskPath,
      workspace,
      {},
      async () => {},
      Date.now,
      {
        codec: gameBuildCodec,
        id: randomUUID,
        executor: { run: async () => ({ code: 0 }) },
        execution: {
          async execute(input) {
            assert.ok(input.inputs[idea].includes('정확히 7개'), provider);
            assert.equal(input.inputs[design], files[design]);
            return {
              plan: {
                version: 1,
                entry: 'main.js',
                html: 'index.html',
                files: ['main.js', 'index.html'],
                assets: [],
              },
              sources: {
                'main.js': 'document.body.textContent="game";',
                'index.html':
                  '<html><body><script type="module" src="./main.js"></script></body></html>',
              },
              html: '<!doctype html><html><body><canvas></canvas></body></html>',
              lock: { version: 1, roots: {}, packages: [] },
              notices: { version: 1, packages: [] },
              toolsetSha256: 'f'.repeat(64),
              profile: 'standalone-browser-v1',
            };
          },
        },
      },
    );
    await service.preparePhase();
    Object.assign(staged, generated(service.stages[0]));
    await service.advance();
    service.stageIndex = 1;
    await service.preparePhase();
    const context = taskInstructionContract(staged[taskPath]),
      inputs = await service.inputFiles();
    assert.ok(inputs[idea].includes('정확히 7개'), provider);
    assert.equal(inputs[design], files[design]);
    assert.equal(
      context.context.originalInstructions.organize,
      original.instructions.organize,
    );
    assert.equal(
      context.context.designDocuments.length,
      defaultDocumentTemplates().length + 1,
    );
    assert.ok(matter(staged[taskPath]).data.inputs.includes(idea));
    const target = matter(staged[taskPath]).data.expected_outputs[0];
    staged[target] =
      '<!doctype html><html><body><canvas></canvas></body></html>';
    await service.executePhase(
      { providerId: provider },
      new AbortController().signal,
      () => {},
    );
    await service.embedAssets(provider);
    const final = await service.validateFinal(
      () => {},
      () => {},
    );
    assert.equal(final.outputs.length, defaultDocumentTemplates().length + 1);
    assert.equal(staged[idea], files[idea]);
  }
});

test('a user-edited design document is the run baseline and survives output rollback', async () => {
  const raw = createTaskPlan(
    {
      kind: 'implement',
      inputPaths: [idea, design],
      x: 1,
      y: 2,
      htmlResult: { mode: 'update', basePath: 'output/index.html' },
    },
    'edited-design',
    files,
  );
  const baseline = {
    ...files,
    [taskPath]: raw,
    [design]: files[design] + '\n사용자가 실행 직전에 HUD를 위쪽으로 변경.',
  };
  let current = { ...baseline },
    staged = {
      ...baseline,
      'output/index.html': '<!doctype html><html><body>new</body></html>',
    };
  const service = new AiRunService(
    baseline,
    taskPath,
    {
      directory: '/isolated',
      capture: async () => ({ ...staged }),
      write: async (path, text) => {
        staged[path] = text;
      },
    },
    {
      capture: async () => ({ ...current }),
      apply: async (_before, changes) => {
        for (const [path, text] of Object.entries(changes))
          if (text === null) delete current[path];
          else current[path] = text;
      },
      saveHistory: async (_before, _after, entry) => {
        if (entry.status === 'completed') throw Error('disk failure');
      },
    },
    async () => {},
  );
  assert.ok((await service.inputFiles())[design].includes('실행 직전에'));
  const final = await service.validateFinal(
    () => {},
    () => {},
  );
  await assert.rejects(
    service.publish(final.staged, final.outputs, {
      history: {
        id: 'rollback',
        label: '구현',
        kind: 'ai',
        status: 'starting',
        createdAt: 1,
      },
      lockBaseline: baseline,
      fileLock: taskFileLock(baseline, taskPath),
      cancelled: () => false,
      requiresLease: false,
      phase: () => {},
    }),
    /disk failure/,
  );
  assert.deepEqual(current, baseline);
});

test('layout and result relocation remap live paths while preserving frozen user prose and hashes', () => {
  const custom = `문서 ${idea}와 output/index.html을 참고한다.\n- 원본 요구와 설계 기준의 고정 정보: 사용자의 문구`;
  const raw = createTaskPlan(
    gamejamTaskInput(request({ organize: custom, implement: custom })),
    'relocation',
    files,
  );
  const original = workflowStages(raw).map(
    (stage) => taskInstructionContract(stage).effective,
  );
  const migrated = planProjectLayout(
    { ...files, [taskPath]: raw },
    layoutMarkdownCodec,
    remapLayoutMarkdown,
  );
  assert.notEqual(matter(migrated[taskPath]).data.inputs[0], idea);
  assert.deepEqual(
    workflowStages(migrated[taskPath]).map(
      (stage) => taskInstructionContract(stage).effective,
    ),
    original,
  );
  const target = 'output/inbox/moved/v001/index.html';
  const moved = relocateResults(migrated, [
    { from: 'output/index.html', to: target },
  ]);
  assert.deepEqual(
    workflowStages(moved[taskPath]).map(
      (stage) => taskInstructionContract(stage).effective,
    ),
    original,
  );
  assert.equal(
    taskInstructionContract(workflowStages(moved[taskPath])[1]).context
      .originalInstructions.implement,
    custom,
  );
  const remapped = remapResultChanges(moved, { [taskPath]: raw });
  // A historical record follows current HTML aliases without rewriting its original instruction text.
  assert.deepEqual(
    workflowStages(remapped[taskPath]).map(
      (stage) => taskInstructionContract(stage).effective,
    ),
    original,
  );
});

test('fallback history reconstruction preserves explicit custom origin and old workflow bytes remain unchanged', () => {
  const edited = editRequestInstructions(
    prepareRequestInstructions(request(), true).request,
    'implement',
    LEGACY_TASK_INSTRUCTIONS_V1.implement,
  );
  const raw = createTaskPlan(gamejamTaskInput(edited), 'fallback', files),
    parsed = matter(raw);
  delete parsed.data.gamejam_request;
  const restored = requestSnapshotFromTask(
    matter.stringify(parsed.content, parsed.data),
  );
  assert.equal(restored.request.instructionOrigins.implement.source, 'custom');
  assert.equal(
    prepareRequestInstructions(restored.request, true).request.instructions
      .implement,
    LEGACY_TASK_INSTRUCTIONS_V1.implement,
  );
  const legacy = matter(raw);
  const strip = (stage) => {
    const parsed = matter(stage);
    delete parsed.data.effective_instructions;
    delete parsed.data.task_context;
    parsed.data.instruction_template_version = 1;
    return matter.stringify(parsed.content, parsed.data);
  };
  legacy.data.workflow_steps = legacy.data.workflow_steps.map(strip);
  delete legacy.data.effective_instructions;
  delete legacy.data.task_context;
  legacy.data.instruction_template_version = 1;
  const historical = matter.stringify(legacy.content, legacy.data),
    snapshot = historical;
  assert.deepEqual(workflowStages(historical), legacy.data.workflow_steps);
  assert.equal(historical, snapshot);
  assert.ok(
    readSavedRequest({
      version: 1,
      request: edited,
      providerId: 'codex-cli',
      modelId: '',
    }),
  );
});

test('older servers reject new provenance requests before submission while legacy requests keep their existing path', async () => {
  const client = new CollaborationClient(
    {
      serverUrl: 'http://127.0.0.1:4317',
      projectId: randomUUID(),
      token: 'fixture',
    },
    () => {},
  );
  client.state = {
    ...client.state,
    connected: true,
    role: 'admin',
    taskInstructionsEditable: true,
    gamejamWorkflow: true,
    documentOutputFormats: true,
    requestApprovalVersion: 1,
  };
  let sent = false;
  client.request = async () => {
    sent = true;
    throw Error('must not send');
  };
  const prepared = prepareRequestInstructions(request(), true).request;
  await assert.rejects(
    client.command('tasks:create', gamejamTaskInput(prepared)),
    /서버.*업데이트/,
  );
  await assert.rejects(
    client.mutateApproval('create', {
      commandId: randomUUID(),
      request: prepared,
    }),
    /서버.*업데이트/,
  );
  assert.equal(sent, false);
  client.stop();
});

test('shared task creation retains explicit custom provenance and rejects a mismatched original request snapshot', () => {
  const chosen = editRequestInstructions(
    prepareRequestInstructions(request(), true).request,
    'organize',
    '사용자가 명시적으로 편집한 지시',
  );
  const input = gamejamTaskInput(chosen, {
    providerId: 'codex-cli',
    modelId: '',
  });
  const shared = reduceCollaboration(files, 'tasks:create', input);
  const raw = shared.files[shared.result.relativePath];
  assert.equal(
    taskInstructionContract(workflowStages(raw)[0]).effective.source,
    'custom',
  );
  const fallback = { ...input };
  delete fallback.instructionOrigin;
  assert.equal(
    taskInstructionContract(
      workflowStages(createTaskPlan(fallback, 'fallback-origin', files))[0],
    ).effective.source,
    'custom',
  );
  assert.throws(
    () =>
      createTaskPlan(
        { ...input, instructions: '스냅샷과 다른 지시' },
        'mismatch',
        files,
      ),
    /원본 요청과 실행 지시/,
  );
});
