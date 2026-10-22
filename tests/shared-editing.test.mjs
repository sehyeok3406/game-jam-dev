import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import matter from '../src/markdown.ts';
import { SharedWorkspaceReader } from '../src/application/editing/shared-workspace-reader.ts';
import { SharedEditingService } from '../src/application/editing/shared-editing-service.ts';
import { LocalCommandService } from '../src/application/editing/command-service.ts';
import { applyExternalCommand } from '../src/application/editing/command-service.ts';
import { dispatchSharedEditingIpc } from '../src/desktop/ipc/collaboration.ts';
import { CanvasView } from '../src/canvas-view.ts';
import { EditJournal } from '../src/edit-journal.ts';
import { COMMAND_LABELS } from '../src/contracts/commands.ts';
import { snapshotDrawings } from '../src/drawing-model.ts';
import {
  commands,
  initial,
  environment,
  docPath,
  sectionPath,
  htmlPath,
  html,
} from './shared-editing-fixtures.mjs';
const signature = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture(files = initial()) {
  const state = {
    files: structuredClone(files),
    revisions: { [docPath]: 5 },
    properties: { [docPath]: { content: 3, workflow: 2, structure: 1 } },
    authorship: {},
  };
  let current = true,
    fail = false;
  const effects = [],
    history = new EditJournal(),
    env = environment();
  const project = {
    read: () => state,
    command: async (channel, input) => {
      if (fail) throw Error('commit failed');
      const plan = applyExternalCommand(state.files, channel, input, env);
      state.files = plan.files;
      return { result: plan.result, historyId: 'receipt' };
    },
    changeHistory: async (id, direction) => {
      if (fail) throw Error('history failed');
      effects.push([id, direction]);
    },
  };
  const reader = new SharedWorkspaceReader(
    project.read,
    new CanvasView(),
    signature,
  );
  const ports = {
    project,
    reader,
    journal: history,
    assertCurrent: () => {
      if (!current) throw Error('session changed');
    },
    assertAllowed: async () => {},
    assertUnlocked: () => {},
    sync: async () => {
      effects.push('sync');
    },
    trash: async () => {
      effects.push('trash');
    },
    changed: () => effects.push('changed'),
  };
  const service = new SharedEditingService(ports);
  return {
    state,
    service,
    reader,
    ports,
    project,
    effects,
    history,
    fail: () => {
      fail = true;
    },
    invalidate: () => {
      current = false;
    },
  };
}
function repository(files) {
  let current = structuredClone(files);
  const writes = [];
  return {
    capture: async () => current,
    apply: async (before, changes) => {
      for (const key of Object.keys(changes)) {
        assert.equal(current[key], before[key]);
        if (changes[key] === null) delete current[key];
        else current[key] = changes[key];
      }
      writes.push(changes);
    },
    get files() {
      return current;
    },
    writes,
  };
}
const invoke = async (f, channel, input) => {
  const result = dispatchSharedEditingIpc(
    channel,
    channel === 'layouts:update' ? [input.updates] : [input],
    f.service,
    (action) => action(),
  );
  assert.equal(result.handled, true, channel);
  return result.value;
};

test('shared editing matrix covers every public reducer command exactly once', () => {
  assert.equal(commands.length, 26);
  assert.deepEqual(
    commands.map((c) => c.channel).sort(),
    Object.keys(COMMAND_LABELS).sort(),
  );
});
for (const spec of commands) {
  test(`shared IPC/local calculation: ${spec.channel} preserves content, result adaptation and receipts`, async () => {
    const before = initial(),
      f = fixture(before),
      local = repository(before);
    const input = structuredClone(spec.input);
    const localResult = await new LocalCommandService(
      local,
      environment(),
    ).execute(spec.channel, structuredClone(input));
    const sharedResult = await invoke(f, spec.channel, input);
    assert.deepEqual(f.state.files, local.files);
    assert.equal(local.writes.length, 1);
    if (spec.channel === 'documents:save') {
      assert.equal(localResult, undefined);
      assert.equal(sharedResult.body, '한글 수정 본문');
      assert.equal(sharedResult.contentRevision, 3);
      assert.equal(sharedResult.workflowRevision, 2);
    } else if (spec.channel === 'drawings:apply')
      assert.deepEqual(sharedResult, snapshotDrawings(local.files));
    else assert.deepEqual(sharedResult, localResult);
    assert.equal(
      f.history.undoStack.length,
      spec.channel === 'tasks:create' ? 0 : 1,
    );
    assert.equal(f.effects.at(-1), 'changed');
    for (const [relative, raw] of Object.entries(before))
      if (local.files[relative] === raw)
        assert.equal(
          local.writes[0][relative],
          undefined,
          'unchanged files are never republished',
        );
    if (
      ![
        'documents:delete',
        'documents:delete-many',
        'canvas:batch',
        'results:move',
        'results:organize',
      ].includes(spec.channel)
    )
      assert.equal(f.state.files[htmlPath], html);
    for (const [relative, raw] of Object.entries(f.state.files))
      if (
        raw.includes('unknown_field: preserve') &&
        !(spec.channel === 'documents:save' && relative === docPath)
      )
        assert.ok(
          raw.includes('한글 원문'),
          'unrelated original Markdown body survives',
        );
  });
  test(`shared IPC/local rejection: ${spec.channel} leaves all inputs/history unchanged`, async () => {
    const before = spec.invalidBefore
      ? spec.invalidBefore(initial())
      : initial();
    const f = fixture(before),
      local = repository(before);
    await assert.rejects(
      new LocalCommandService(local, environment()).execute(
        spec.channel,
        structuredClone(spec.invalid),
      ),
    );
    await assert.rejects(
      invoke(f, spec.channel, structuredClone(spec.invalid)),
    );
    assert.deepEqual(f.state.files, before);
    assert.deepEqual(local.files, before);
    assert.deepEqual(local.writes, []);
    assert.deepEqual(f.effects, []);
    assert.equal(f.history.undoStack.length, 0);
  });
}

test('each shared command propagates commit failure without acknowledging history or local effects', async () => {
  for (const spec of commands) {
    const f = fixture();
    f.fail();
    await assert.rejects(
      invoke(f, spec.channel, structuredClone(spec.input)),
      /commit failed/,
    );
    assert.deepEqual(f.state.files, initial());
    assert.deepEqual(f.effects, []);
    assert.equal(f.history.undoStack.length, 0);
  }
});

test('personal collapse/cache state belongs to one session and text edits do not retransmit HTML', async () => {
  const first = fixture(),
    second = fixture();
  await invoke(first, 'documents:set-collapsed', {
    relativePath: docPath,
    collapsed: true,
  });
  assert.equal(first.reader.document(docPath).collapsed, true);
  assert.equal(second.reader.document(docPath).collapsed, false);
  assert.equal(matter(first.state.files[docPath]).data.collapsed, undefined);
  const baseline = first.reader.canvasChanges({});
  assert.equal(baseline.previews[0].content, html);
  await invoke(first, 'documents:save', {
    relativePath: docPath,
    title: 'Changed',
    body: 'New body',
  });
  const delta = first.reader.canvasChanges(baseline.signatures);
  assert.equal(delta.previews.length, 0);
  assert.equal(delta.documents.length, 1);
  assert.equal(delta.documents[0].collapsed, true);
  assert.equal(delta.documents[0].workflowRevision, 2);
  assert.equal(
    first.reader.canvasChanges(delta.signatures).documents.length,
    0,
  );
  assert.equal(second.reader.canvasChanges({}).previews.length, 1);
});

test('stale session and AI-locked personal folds never update another session or perform filesystem effects', async () => {
  const f = fixture();
  const original = f.project.command;
  f.project.command = async (...args) => {
    const result = await original(...args);
    f.invalidate();
    return result;
  };
  await assert.rejects(
    invoke(f, 'documents:save', {
      relativePath: docPath,
      title: 'Committed in A',
      body: 'A',
    }),
    /session changed/,
  );
  assert.deepEqual(f.effects, []);
  assert.equal(f.history.undoStack.length, 0);
  const second = fixture();
  second.ports.assertUnlocked = () => {
    throw Error('AI locked');
  };
  await assert.rejects(
    invoke(second, 'documents:set-collapsed', {
      relativePath: docPath,
      collapsed: true,
    }),
    /AI locked/,
  );
  assert.equal(second.reader.document(docPath).collapsed, false);
});

test('Undo/Redo advances the original journal only after server success', async () => {
  const f = fixture();
  f.history.push({ id: 'edit', label: 'Edit' });
  f.fail();
  await assert.rejects(invoke(f, 'edit:undo'), /history failed/);
  assert.equal(f.history.state.undo, 'Edit');
  assert.equal(f.history.state.redo, null);
  const second = fixture();
  second.history.push({ id: 'edit', label: 'Edit' });
  await invoke(second, 'edit:undo');
  assert.equal(second.history.state.redo, 'Edit');
  await invoke(second, 'edit:redo');
  assert.equal(second.history.state.undo, 'Edit');
});

test('shared queries preserve detail/list revision contracts, missing results and native fallback', async () => {
  const f = fixture();
  assert.equal((await invoke(f, 'documents:get', docPath)).workflowRevision, 2);
  assert.equal(
    (await invoke(f, 'documents:list')).find((d) => d.relativePath === docPath)
      .workflowRevision,
    undefined,
  );
  assert.equal((await invoke(f, 'sections:list'))[0].relativePath, sectionPath);
  assert.equal(await invoke(f, 'documents:get', 'ideas/missing.md'), null);
  assert.deepEqual(await invoke(f, 'preview:read', 'output/versions/v9.html'), {
    exists: false,
    relativePath: 'output/versions/v9.html',
    content: '',
  });
  await assert.rejects(
    invoke(f, 'assets:read', '../unsafe.png'),
    /프로젝트 이미지/,
  );
  assert.deepEqual(
    dispatchSharedEditingIpc('workspace:open-folder', [], f.service, (action) =>
      action(),
    ),
    { handled: false },
  );
  assert.deepEqual(
    dispatchSharedEditingIpc('constructor', [], f.service, (action) =>
      action(),
    ),
    { handled: false },
  );
});

test('authorization and queued session checks happen before any shared command is submitted', async () => {
  const locked = fixture();
  let commands = 0;
  locked.project.command = async () => {
    commands++;
    return { result: null, historyId: 'unexpected' };
  };
  locked.ports.assertAllowed = async () => {
    throw Error('AI locked');
  };
  await assert.rejects(
    invoke(locked, 'documents:save', {
      relativePath: docPath,
      title: 'Blocked',
      body: 'Blocked',
    }),
    /AI locked/,
  );
  assert.equal(commands, 0);
  const queued = fixture();
  let action;
  const routed = dispatchSharedEditingIpc(
    'documents:delete',
    [{ documentId: 'a', relativePath: docPath }],
    queued.service,
    (operation) => {
      action = operation;
      return Promise.resolve();
    },
  );
  assert.equal(routed.handled, true);
  queued.invalidate();
  await assert.rejects(action(), /session changed/);
  assert.deepEqual(queued.state.files, initial());
});

test('injected IDs/time reach imported HTML metadata and shared status-property calculations', async () => {
  const f = fixture();
  const result = await invoke(f, 'files:import-batch', {
    x: 10,
    y: 10,
    imagePurpose: 'asset',
    files: [{ name: 'source.html', content: html }],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'reference');
  assert.equal(result[0].modifiedAt, 1234);
  const imported = Object.entries(f.state.files)
    .filter(([p]) => p.startsWith('docs/html-sources/'))
    .map(([, raw]) => matter(raw));
  assert.equal(imported.length, 1);
  assert.equal(imported[0].data.updated_at, 1234);
  assert.ok(
    imported[0].data.html_source.includes(
      'import-10000001-0000-4000-8000-000000000001',
    ),
  );
  const property = fixture();
  const id = (await import('../src/html-source.ts')).htmlSourceId(htmlPath);
  await invoke(property, 'files:set-status-property', {
    relativePath: htmlPath,
    objectId: id,
    expectedEnabled: true,
    statusId: 'in-progress',
  });
  const management = Object.entries(property.state.files)
    .filter(([p]) => p.startsWith('docs/html-sources/'))
    .map(([, raw]) => matter(raw));
  assert.equal(management[0].data.updated_at, 1234);
});
