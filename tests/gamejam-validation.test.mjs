import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gamejamIssues } from '../src/gamejam-validation.ts';
import {
  DEFAULT_TASK_INSTRUCTIONS,
  MAX_TASK_INSTRUCTIONS,
} from '../src/task-instructions.ts';

const request = {
  organize: true,
  implement: true,
  inputPaths: ['ideas/a.md'],
  x: 0,
  y: 0,
  instructions: { ...DEFAULT_TASK_INSTRUCTIONS },
  resultName: '',
  htmlResult: { mode: 'new' },
};
const collaboration = {
  active: true,
  connected: true,
  members: [],
  locks: [],
  role: 'admin',
  htmlResultFolders: true,
  htmlComposition: true,
  htmlImportAnalysis: true,
  gamejamWorkflow: true,
  taskResultNaming: true,
  taskInstructionsEditable: true,
  multiProviderAi: true,
};
const context = {
  collaboration: { active: false, connected: false, members: [], locks: [] },
  provider: 'codex-cli',
  model: '',
  connection: {
    available: true,
    authenticated: true,
    message: '',
    version: null,
    executablePath: null,
  },
  checkingConnection: false,
  aiBusy: false,
  locked: false,
  updateRestarting: false,
};
test('valid local/shared requests and optional empty name/model remain executable', () => {
  assert.deepEqual(gamejamIssues(request, context), []);
  assert.deepEqual(gamejamIssues(request, { ...context, collaboration }), []);
});
test('field validation uses the real name/instruction rules and skips disabled stages', () => {
  assert.equal(
    gamejamIssues({ ...request, resultName: '2인용 · 버전 1' }, context)[0]
      .field,
    'name',
  );
  for (const value of [
    '',
    'a'.repeat(MAX_TASK_INSTRUCTIONS + 1),
    'text\u0001',
  ]) {
    const next = {
      ...request,
      instructions: { ...request.instructions, implement: value },
    };
    assert.equal(gamejamIssues(next, context)[0].field, 'implement');
    assert.deepEqual(gamejamIssues({ ...next, implement: false }, context), []);
  }
  assert.equal(
    gamejamIssues({ ...request, organize: false, implement: false }, context)[0]
      .field,
    'steps',
  );
  assert.equal(
    gamejamIssues(request, { ...context, model: 'invalid model' })[0].field,
    'model',
  );
});
test('source HTML overwrite is blocked inline while a new version is allowed', () => {
  const next = {
    ...request,
    sourceMode: 'html-compose',
    inputPaths: ['output/index.html'],
    htmlResult: { mode: 'update', basePath: 'output/index.html' },
  };
  assert.equal(gamejamIssues(next, context)[0].field, 'html-result');
  assert.deepEqual(
    gamejamIssues(
      { ...next, htmlResult: { ...next.htmlResult, mode: 'new' } },
      context,
    ),
    [],
  );
});
test('connection, role, sync, busy and restart blocks always have a visible reason', () => {
  for (const override of [
    { connection: null },
    { checkingConnection: true },
    { connection: { ...context.connection, authenticated: false } },
    { aiBusy: true },
    { locked: true },
    { updateRestarting: true },
  ]) {
    assert(gamejamIssues(request, { ...context, ...override }).length);
  }
  for (const change of [
    { connected: false },
    { pendingChanges: 1 },
    { accessDenied: true },
    { role: 'viewer' },
    { role: 'editor', editorAi: false },
  ]) {
    assert(
      gamejamIssues(request, {
        ...context,
        collaboration: { ...collaboration, ...change },
      }).some((issue) => issue.field === 'connection'),
    );
  }
  assert.deepEqual(
    gamejamIssues(request, {
      ...context,
      collaboration: { ...collaboration, role: 'editor', editorAi: true },
    }),
    [],
  );
});
test('every existing server capability gate has feedback and does not block supported operations', () => {
  const next = { ...request, sourceMode: 'html', resultName: '게임 이름' };
  for (const capability of [
    'htmlResultFolders',
    'htmlComposition',
    'htmlImportAnalysis',
    'gamejamWorkflow',
    'taskResultNaming',
    'taskInstructionsEditable',
    'multiProviderAi',
  ]) {
    const issues = gamejamIssues(next, {
      ...context,
      provider: 'claude-cli',
      collaboration: { ...collaboration, [capability]: false },
    });
    assert(issues.length, capability);
    assert(
      issues.every((issue) => issue.message.trim()),
      capability,
    );
  }
  assert.deepEqual(
    gamejamIssues(next, { ...context, provider: 'claude-cli', collaboration }),
    [],
  );
});
