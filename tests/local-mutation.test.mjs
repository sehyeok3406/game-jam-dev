import assert from 'node:assert/strict';
import { test } from 'node:test';
import matter from 'gray-matter';
import { LocalMutationService } from '../src/application/editing/local-mutation-service.ts';

const md = (id, extra = {}) =>
  matter.stringify('원문 내용', {
    id,
    title: id,
    type: 'idea',
    custom: 'keep',
    ...extra,
  });
function fixture(
  initial = {
    'ideas/a.md': md('a'),
    'output/index.html': 'large unchanged HTML',
  },
) {
  let files = { ...initial },
    current = true;
  const captures = [],
    records = [],
    calls = [];
  const ports = {
    assertCurrent: () => {
      if (!current) throw Error('stale');
    },
    project: {
      capture: async (paths) => {
        captures.push(paths);
        return paths
          ? Object.fromEntries(
              paths
                .filter((p) => files[p] !== undefined)
                .map((p) => [p, files[p]]),
            )
          : { ...files };
      },
      apply: async (before, changes) => {
        calls.push('workflow');
        for (const [key, value] of Object.entries(changes)) {
          assert.equal(files[key], before[key]);
          files[key] = value;
        }
      },
    },
    record: async (before, after, label) => {
      calls.push('record');
      records.push({ before, after, label });
    },
    changed: () => calls.push('changed'),
  };
  return {
    ports,
    captures,
    records,
    calls,
    service: new LocalMutationService(ports),
    get files() {
      return files;
    },
    set: (key, value) => (files[key] = value),
    expire: () => (current = false),
  };
}
for (const channel of [
  'documents:save',
  'documents:update-layout',
  'documents:set-collapsed',
]) {
  test(`${channel} captures only its Markdown, retains unknown fields and never records unchanged HTML`, async () => {
    const f = fixture();
    const result = await f.service.execute(
      channel,
      [{ relativePath: 'ideas/a.md' }],
      async () => {
        f.set('ideas/a.md', md('a', { x: 200 }));
        return { saved: true };
      },
    );
    assert.deepEqual(result, { saved: true });
    assert.deepEqual(f.captures, [['ideas/a.md'], ['ideas/a.md']]);
    assert.deepEqual(Object.keys(f.records[0].before), ['ideas/a.md']);
    assert.deepEqual(Object.keys(f.records[0].after), ['ideas/a.md']);
    assert.match(f.records[0].after['ideas/a.md'], /custom: keep/);
    assert.equal(f.files['output/index.html'], 'large unchanged HTML');
    assert.deepEqual(f.calls, ['record', 'changed']);
  });
}
test('no-op edit keeps notification behavior without creating empty history', async () => {
  const f = fixture();
  await f.service.execute(
    'documents:save',
    [{ relativePath: 'ideas/a.md' }],
    async () => 7,
  );
  assert.equal(f.records.length, 0);
  assert.deepEqual(f.calls, ['changed']);
});
test('creation applies only missing new-document workflow before acknowledging its history', async () => {
  const original = md('a', {
    status_property_enabled: true,
    workflow_status_id: 'todo',
    workflow_order: 123,
  });
  const f = fixture({ 'ideas/a.md': original });
  await f.service.execute('documents:create-idea', [], async () =>
    f.set('ideas/new.md', md('new')),
  );
  assert.equal(
    matter(f.files['ideas/new.md']).data.status_property_enabled,
    false,
  );
  assert.equal(f.files['ideas/a.md'], original);
  assert.equal(matter(f.files['ideas/new.md']).data.custom, 'keep');
  assert.deepEqual(f.calls, ['workflow', 'record', 'changed']);
  assert.deepEqual(f.captures, [undefined, undefined]);
  assert.equal(f.records[0].after['ideas/new.md'], f.files['ideas/new.md']);
});
test('native clipboard and explicit/manual command handlers keep their own single history acknowledgement', async () => {
  for (const channel of [
    'clipboard:canvas-paste',
    'sections:rename',
    'documents:delete-many',
    'documents:set-color',
    'layouts:update',
  ]) {
    const f = fixture();
    let ownHistory = 0;
    await f.service.execute(channel, [], async () => {
      ownHistory++;
      f.set('ideas/a.md', md('a', { x: 99 }));
    });
    assert.equal(ownHistory, 1);
    assert.equal(f.records.length, 0);
    assert.equal(f.captures.length, 0);
    assert.deepEqual(f.calls, ['changed']);
  }
});
test('task creation retains its legacy label so the existing journal excludes AI requests', async () => {
  const f = fixture();
  await f.service.execute('tasks:create', [], async () =>
    f.set('.ai/tasks/legacy-timestamp.md', md('task')),
  );
  assert.equal(f.records[0].label, 'AI 작업 요청');
  assert.ok(f.files['.ai/tasks/legacy-timestamp.md']);
});
for (const stage of ['before', 'operation', 'after', 'workflow', 'history']) {
  test(`local mutation ${stage} failure is reported without changed/success acknowledgement`, async () => {
    const f = fixture();
    if (stage === 'before')
      f.ports.project.capture = async () => {
        throw Error('injected');
      };
    if (stage === 'after') {
      let reads = 0;
      const capture = f.ports.project.capture;
      f.ports.project.capture = async (...args) => {
        if (++reads === 2) throw Error('injected');
        return capture(...args);
      };
    }
    if (stage === 'workflow')
      f.ports.project.apply = async () => {
        throw Error('injected');
      };
    if (stage === 'history')
      f.ports.record = async () => {
        throw Error('injected');
      };
    await assert.rejects(
      f.service.execute('documents:create-idea', [], async () => {
        if (stage === 'operation') throw Error('injected');
        f.set('ideas/new.md', md('new'));
      }),
      /injected/,
    );
    assert.ok(!f.calls.includes('changed'));
    assert.equal(f.records.length, 0);
  });
}
test('stale capture is rejected before invoking the mutation handler', async () => {
  const f = fixture(),
    capture = f.ports.project.capture;
  f.ports.project.capture = async (...args) => {
    const before = await capture(...args);
    f.expire();
    return before;
  };
  let called = false;
  await assert.rejects(
    f.service.execute(
      'documents:save',
      [{ relativePath: 'ideas/a.md' }],
      async () => {
        called = true;
      },
    ),
    /stale/,
  );
  assert.equal(called, false);
  assert.equal(f.records.length, 0);
  assert.equal(f.calls.length, 0);
});
test('late handler response cannot record history or notify a newly opened project', async () => {
  const f = fixture();
  await assert.rejects(
    f.service.execute(
      'documents:save',
      [{ relativePath: 'ideas/a.md' }],
      async () => {
        f.expire();
        return 'late';
      },
    ),
    /stale/,
  );
  assert.equal(f.records.length, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(f.captures.length, 1);
});
