import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import matter from '../src/markdown.ts';
import {
  AiRunCoordinator,
  recordAiPreparationFailure,
} from '../src/application/ai/run-coordinator.ts';
import { AiRunEvents } from '../src/application/ai/run-events.ts';
import { ProviderRunOutput } from '../src/adapters/node/ai/run-output.ts';
import { fileAiRunRecords } from '../src/desktop/ai/run-records.ts';

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const session = { projectKey: 'project-a', sessionId: 'session-a', epoch: 1 };
const taskPath = '.ai/tasks/run.md';
const line = (message) =>
  JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: message },
  });
function fixture(stages = []) {
  const received = [],
    reports = [],
    histories = [],
    tasks = [],
    errors = [],
    actions = [];
  let current = true,
    executors = 0,
    cancels = 0,
    completions = 0,
    publishes = 0;
  const identity = {
    runId: 'run',
    taskPath,
    projectSession: session,
    actorId: 'actor-a',
    providerId: 'codex-cli',
    modelId: null,
    reasoningEffort: null,
  };
  const events = new AiRunEvents(identity, {
    publish: (e) => received.push(e),
    persist: async () => {},
    error: (e) => errors.push(e),
    now: () => 1234,
  });
  const output = new ProviderRunOutput('codex-cli', (kind, message) =>
    events.emit('running', kind, message),
  );
  const workflow = {
    stages,
    stageIndex: 0,
    preparePhase: async () => actions.push(`prepare-${workflow.stageIndex}`),
    embedAssets: async () => {},
    advance: async () => actions.push('advance'),
    validateFinal: async (outputs, phase) => {
      actions.push('validate');
      phase('artifact-validation');
      outputs(['output/result.html']);
      return {
        staged: { 'output/result.html': 'result' },
        outputs: ['output/result.html'],
      };
    },
    publish: async (staged, outputs, input) => {
      if (input.requiresLease && !input.shared) throw Error('expired lease');
      if (input.cancelled()) throw Error('cancelled');
      if (input.shared) await input.shared.finish(staged);
      publishes++;
      actions.push('publish');
    },
  };
  const executor = {
    inspect: async () => {},
    run: async (input, signal, emit) => {
      executors++;
      actions.push('execute');
      emit({ stream: 'stdout', text: line(`result-${executors}`) });
      return { code: 0 };
    },
    cancel: async () => {
      cancels++;
    },
  };
  const records = {
    diagnostic: async (report) => reports.push(structuredClone(report)),
    history: async (entry) => histories.push(structuredClone(entry)),
    task: async (status, fields) => tasks.push({ status, ...fields }),
    specification: async () => undefined,
  };
  const context = {
    sessionRef: session,
    root: 'original-project-a',
    taskPath,
    baseline: {},
    lockBaseline: {},
    fileLock: { paths: ['ideas/a.md'], folders: [] },
    outputs: ['output/initial.html'],
    requiresLease: false,
    prepared: {
      runId: 'run',
      taskId: 'stable-task-id',
      stage: 'isolated-stage-a',
      providerId: 'codex-cli',
      modelId: null,
      executable: { executable: 'mock-only', prefix: [] },
      prompt: 'frozen',
    },
    history: {
      id: 'run',
      label: 'run',
      kind: 'ai',
      status: 'starting',
      taskPath,
      createdAt: 1000,
    },
  };
  const ports = {
    executor,
    workflow,
    output,
    events,
    records,
    assertCurrent: () => {
      if (!current) throw Error('session changed');
    },
    serial: (fn) => fn(),
    complete: async () => {
      completions++;
    },
    error: (message, error) => errors.push([message, error]),
    appVersion: 'test',
    now: () => 2000,
  };
  return {
    context,
    ports,
    identity,
    events,
    executor,
    workflow,
    records,
    received,
    reports,
    histories,
    tasks,
    errors,
    actions,
    switchProject: () => {
      current = false;
    },
    counts: () => ({ executors, cancels, completions, publishes }),
  };
}

test('Grok receives fresh scoped inputs for both phases and checks the session again after input capture', async () => {
  const f = fixture(['first', 'second']);
  f.context.prepared.providerId = 'grok-cli';
  const seen = [];
  f.workflow.inputFiles = async () => ({
    phase: String(f.workflow.stageIndex),
  });
  f.executor.run = async (input) => {
    seen.push(input.inputFiles);
    return { code: 0 };
  };
  const run = new AiRunCoordinator(f.context, f.ports);
  await run.prepare();
  await run.run();
  assert.deepEqual(seen, [{ phase: '0' }, { phase: '1' }]);
  const stale = fixture();
  stale.context.prepared.providerId = 'grok-cli';
  stale.workflow.inputFiles = async () => {
    stale.switchProject();
    return {};
  };
  await new AiRunCoordinator(stale.context, stale.ports).run();
  assert.equal(stale.counts().executors, 0);
  assert.equal(stale.counts().publishes, 0);
});

test('coordinator executes/finalizes once and ignores late stream callbacks after completion', async () => {
  const f = fixture();
  let late;
  f.executor.run = async (_input, _signal, emit) => {
    late = emit;
    emit({ stream: 'stdout', text: line('finished') });
    return { code: 0 };
  };
  const run = new AiRunCoordinator(f.context, f.ports);
  const first = run.run();
  assert.equal(run.run(), first);
  await first;
  const count = f.received.length;
  late({ stream: 'stdout', text: line('late') + '\n' });
  await run.cancel(true);
  assert.equal(f.received.length, count);
  assert.equal(f.counts().completions, 1);
  assert.equal(f.counts().publishes, 1);
  assert.equal(f.tasks[0].ai_result, 'finished');
  assert.equal(
    f.reports[0].taskPath,
    taskPath,
    'request identity is distinct from the task filename',
  );
  assert.equal(f.received.at(-1).status, 'completed');
});

test('switching sessions during execution blocks publication and records failure only through original bound ports', async () => {
  const f = fixture();
  const pending = deferred();
  f.executor.run = async () => {
    await pending.promise;
    return { code: 0 };
  };
  const run = new AiRunCoordinator(f.context, f.ports);
  const done = run.run();
  f.switchProject();
  pending.resolve();
  await done;
  assert.equal(f.counts().publishes, 0);
  assert.equal(f.counts().completions, 1);
  assert.equal(f.tasks[0].status, 'failed');
  assert.equal(f.reports[0].status, 'failed');
  for (const event of f.received) {
    assert.deepEqual(event.projectSession, session);
    assert.equal(event.actorId, 'actor-a');
  }
  assert.equal(run.root, 'original-project-a');
});

test('cancelling during stage transition never launches the HTML stage or publishes intermediate documents', async () => {
  const f = fixture(['organize', 'implement']),
    entered = deferred(),
    pending = deferred();
  f.workflow.advance = async () => {
    entered.resolve();
    await pending.promise;
  };
  const run = new AiRunCoordinator(f.context, f.ports);
  await run.prepare();
  const done = run.run();
  await entered.promise;
  await Promise.all([run.cancel(), run.cancel()]);
  pending.resolve();
  await done;
  assert.equal(f.counts().executors, 1);
  assert.equal(f.counts().cancels, 0, 'validation has no live process to kill');
  assert.equal(f.counts().publishes, 0);
  assert.equal(f.received.at(-1).status, 'cancelled');
});

test('process cancellation is idempotent; history/task/diagnostic failures cannot strand the execution slot', async () => {
  const f = fixture(),
    entered = deferred(),
    pending = deferred();
  f.executor.run = async () => {
    entered.resolve();
    await pending.promise;
    return { code: null };
  };
  f.records.diagnostic = async () => {
    throw Error('diagnostic disk failure');
  };
  f.records.history = async () => {
    throw Error('history disk failure');
  };
  f.records.task = async () => {
    throw Error('task disk failure');
  };
  const run = new AiRunCoordinator(f.context, f.ports);
  const done = run.run();
  await entered.promise;
  await Promise.all([run.cancel(true, true), run.cancel(true, true)]);
  pending.resolve();
  await done;
  assert.equal(f.counts().cancels, 1);
  assert.equal(f.counts().completions, 1);
  assert.equal(f.received.at(-1).status, 'cancelled');
  assert.equal(f.errors.length, 3);
});

test('zero exit plus provider failure is failed; a failed diagnostic never exposes a nonexistent diagnostic link', async () => {
  const f = fixture();
  f.executor.run = async (_input, _signal, emit) => {
    emit({
      stream: 'stdout',
      text: JSON.stringify({ type: 'error', message: 'provider failed' }),
    });
    return { code: 0 };
  };
  f.records.diagnostic = async () => {
    throw Error('disk full');
  };
  const run = new AiRunCoordinator(f.context, f.ports);
  await run.run();
  assert.equal(f.actions.includes('validate'), false);
  const final = f.received.at(-1);
  assert.equal(final.status, 'failed');
  assert.equal(final.failure.diagnosticPath, undefined);
  assert.match(final.failure.details.diagnosticWriteError, /disk full/);
  assert.equal(f.tasks[0].ai_diagnostic_path, null);
});

test('two-stage run discards first-stage message and stale callbacks while retaining one final publication', async () => {
  const f = fixture(['organize', 'implement']);
  let first,
    attempts = 0;
  f.executor.run = async (_input, _signal, emit) => {
    attempts++;
    if (attempts === 1) first = emit;
    else first({ stream: 'stdout', text: line('stale-first-stage') + '\n' });
    emit({ stream: 'stdout', text: line(`stage-${attempts}`) });
    return { code: 0 };
  };
  const run = new AiRunCoordinator(f.context, f.ports);
  await run.prepare();
  await run.run();
  assert.equal(attempts, 2);
  assert.equal(f.counts().publishes, 1);
  assert.equal(f.tasks[0].ai_result, 'stage-2');
  assert.equal(
    f.received.some((event) => event.message.includes('stale-first-stage')),
    false,
  );
  assert.deepEqual(f.actions, [
    'prepare-0',
    'advance',
    'prepare-1',
    'validate',
    'publish',
  ]);
});

test('lost shared lease never falls back to local publication or finishes a replacement lease', async () => {
  const f = fixture();
  let valid = true,
    finishes = 0;
  f.context.requiresLease = true;
  f.ports.lease = {
    valid: () => valid,
    finish: async () => {
      finishes++;
    },
  };
  const original = f.workflow.validateFinal;
  f.workflow.validateFinal = async (...args) => {
    const result = await original(...args);
    valid = false;
    return result;
  };
  await new AiRunCoordinator(f.context, f.ports).run();
  assert.equal(f.counts().publishes, 0);
  assert.equal(finishes, 0);
  assert.equal(f.tasks[0].status, 'failed');
});

test('event identity is frozen, history is bounded and progress reports only status transitions', async () => {
  const f = fixture();
  const progresses = [];
  const identity = structuredClone(f.identity);
  const events = new AiRunEvents(identity, {
    publish: () => {},
    persist: async () => {},
    progress: async (e) => progresses.push(e.status),
    error: () => {},
    now: () => 1,
  });
  identity.actorId = 'actor-b';
  identity.projectSession.sessionId = 'session-b';
  events.emit('starting', 'status', 'Bearer hidden');
  for (let i = 0; i < 205; i++)
    events.emit('running', 'log', `line-${i} sk-sensitive`);
  events.emit('validating', 'status', 'validate');
  events.emit('completed', 'result', 'complete');
  const snapshot = events.snapshot();
  assert.equal(snapshot.length, 200);
  assert.equal(snapshot[0].actorId, 'actor-a');
  assert.equal(snapshot[0].projectSession.sessionId, 'session-a');
  assert.doesNotMatch(JSON.stringify(snapshot), /sk-sensitive/);
  snapshot[0].message = 'modified';
  assert.notEqual(events.snapshot()[0].message, 'modified');
  assert.deepEqual(progresses, ['starting', 'running', 'validating']);
});

test('preparation failure preserves original identity, review metadata and lease cleanup without reading a new session', async () => {
  const f = fixture();
  let finishes = 0;
  const event = f.events.emit('starting', 'status', 'prepare');
  f.switchProject();
  await recordAiPreparationFailure({
    event,
    events: f.events,
    records: f.records,
    error: Error('prepare failure'),
    cancelled: false,
    lease: {
      valid: () => true,
      finish: async () => {
        finishes++;
      },
    },
    now: () => 2000,
  });
  assert.equal(finishes, 1);
  assert.equal(f.reports[0].phase, 'prepare');
  assert.equal(f.histories[0].taskPath, taskPath);
  assert.equal(f.received.at(-1).actorId, 'actor-a');
  assert.equal(f.tasks[0].status, 'failed');
});

test('desktop records retain byte/hash JSON format, redact secrets and write only their bound original root', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-ai-records-'));
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir());
    await fs.rm(root, { recursive: true, force: true });
  });
  const a = path.join(root, 'project-a'),
    b = path.join(root, 'project-b');
  for (const dir of [a, b]) {
    await fs.mkdir(path.join(dir, '.ai/tasks'), { recursive: true });
    await fs.writeFile(
      path.join(dir, taskPath),
      matter.stringify('preserve body', {
        id: 'task',
        type: 'ai-task',
        status: 'draft',
        unknown_field: 'keep',
      }),
    );
  }
  const raw = '한글 result';
  const records = fileAiRunRecords(a, 'run', taskPath, {
    capture: async () => ({ 'output/result.html': raw }),
  });
  await records.task('failed', { ai_error: 'error' });
  await records.diagnostic({
    schemaVersion: 1,
    runId: 'run',
    taskPath,
    status: 'failed',
    phase: 'execute',
    failure: null,
    outputs: ['output/result.html'],
    events: [{ message: 'Bearer hidden-token' }],
  });
  const reportText = await fs.readFile(
    path.join(a, '.history/run/diagnostic.json'),
    'utf8',
  );
  assert.doesNotMatch(reportText, /hidden-token/);
  const report = JSON.parse(reportText);
  assert.deepEqual(report.outputs, [
    {
      relativePath: 'output/result.html',
      bytes: Buffer.byteLength(raw),
      sha256: createHash('sha256').update(raw).digest('hex'),
    },
  ]);
  assert.equal(
    matter(await fs.readFile(path.join(a, taskPath), 'utf8')).data
      .unknown_field,
    'keep',
  );
  assert.equal(
    matter(await fs.readFile(path.join(b, taskPath), 'utf8')).data.status,
    'draft',
  );
  await assert.rejects(fs.stat(path.join(b, '.history')), { code: 'ENOENT' });
});
