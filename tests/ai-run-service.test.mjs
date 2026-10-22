import assert from 'node:assert/strict';
import { test } from 'node:test';
import matter from '../src/markdown.ts';
import { AiRunService } from '../src/application/ai/run-service.ts';

const taskPath = '.ai/tasks/run.md';
const output = 'output/index.html';
const html = (value) =>
  `<!doctype html><html><head><title>test</title></head><body>${value}</body></html>`;
function fixture() {
  const baseline = {
    [taskPath]: matter.stringify('Only update the game', {
      id: 'task',
      type: 'ai-task',
      title: 'task',
      inputs: ['ideas/a.md'],
      expected_outputs: [output],
      html_output_mode: 'update',
    }),
    'ideas/a.md': matter.stringify('Keep original source', {
      id: 'idea',
      type: 'idea',
      title: 'idea',
      sources: [],
    }),
    [output]: html('old'),
  };
  let current = { ...baseline },
    staged = { ...baseline, [output]: html('new') };
  const commits = [],
    history = [],
    phases = [],
    htmlChecks = [];
  let failCompletion = false;
  const repository = {
    capture: async () => ({ ...current }),
    saveHistory: async (before, after, entry) => {
      history.push(entry.status);
      if (entry.status === 'completed' && failCompletion)
        throw Error('history disk failure');
    },
    apply: async (before, changes, cancelled) => {
      if (cancelled?.()) throw Error('cancelled');
      for (const relative of Object.keys(changes))
        assert.equal(current[relative], before[relative]);
      commits.push(changes);
      for (const [relative, raw] of Object.entries(changes)) {
        if (raw === null) delete current[relative];
        else current[relative] = raw;
      }
    },
  };
  const workspace = {
    directory: '/isolated-stage',
    capture: async () => ({ ...staged }),
    write: async (p, raw) => {
      staged[p] = raw;
    },
  };
  const service = new AiRunService(
    baseline,
    taskPath,
    workspace,
    repository,
    async (raw, p) => htmlChecks.push([raw, p]),
    () => 456,
  );
  const options = {
    history: {
      id: 'run',
      createdAt: 123,
      label: 'run',
      kind: 'ai',
      status: 'starting',
    },
    lockBaseline: baseline,
    fileLock: { paths: ['ideas/a.md'], folders: [] },
    cancelled: () => false,
    requiresLease: false,
    phase: (p) => phases.push(p),
  };
  return {
    service,
    baseline,
    commits,
    history,
    phases,
    htmlChecks,
    options,
    current: () => current,
    staged: () => staged,
    failCompletion: () => {
      failCompletion = true;
    },
  };
}

test('AI publication rolls outputs back when completed-history persistence fails', async () => {
  const f = fixture();
  f.service.inspectInput();
  const resolved = await f.service.validateFinal(() => {}, f.options.phase);
  assert.equal(f.htmlChecks.length, 1);
  f.failCompletion();
  await assert.rejects(
    f.service.publish(resolved.staged, resolved.outputs, f.options),
    /history disk failure/,
  );
  assert.equal(f.commits.length, 2);
  assert.deepEqual(f.history, ['validating', 'completed']);
  assert.deepEqual(f.current(), f.baseline);
});

test('input conflicts, cancelled writes and expired shared claims never fall back to a local commit', async () => {
  for (const mode of ['conflict', 'cancel', 'lease']) {
    const f = fixture();
    const { staged, outputs } = await f.service.validateFinal(
      () => {},
      f.options.phase,
    );
    if (mode === 'conflict') f.current()['ideas/a.md'] += '\nexternal';
    if (mode === 'cancel') f.options.cancelled = () => true;
    if (mode === 'lease') f.options.requiresLease = true;
    await assert.rejects(
      f.service.publish(staged, outputs, f.options),
      mode === 'conflict'
        ? /외부 변경/
        : mode === 'lease'
          ? /실행 권한/
          : /cancelled/,
    );
    assert.equal(f.commits.length, 0);
    assert.equal(f.current()[output], f.baseline[output]);
  }
});

test('shared publication uses only the injected lease publisher; changed input fails final validation', async () => {
  const f = fixture();
  let published;
  const { staged, outputs } = await f.service.validateFinal(
    () => {},
    f.options.phase,
  );
  await f.service.publish(staged, outputs, {
    ...f.options,
    requiresLease: true,
    shared: {
      finish: async (changes) => {
        published = changes;
      },
    },
  });
  assert.equal(published[output], html('new'));
  assert.equal(f.commits.length, 0);
  assert.deepEqual(f.history, []);
  f.staged()['ideas/a.md'] += '\nAI modified source';
  await assert.rejects(
    f.service.validateFinal(() => {}, f.options.phase),
    /입력 문서를 변경/,
  );
});
