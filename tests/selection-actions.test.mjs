import assert from 'node:assert/strict';
import {
  contextSelection,
  selectionMenuTargets,
  selectionMenuPaths,
} from '../src/ui/canvas/selection-menu-plan.ts';
import { test } from 'node:test';
import { CanvasSelectionActions } from '../src/ui/canvas/selection-actions.ts';
import {
  arrangeSelectionItems,
  selectionArrangementItems,
  copiedSelection,
  copyDrawingObjects,
} from '../src/ui/canvas/selection-plan.ts';

const doc = {
  id: 'note',
  title: '원본',
  relativePath: 'docs/note.md',
  revision: 1,
  x: 10,
  y: 20,
  width: 300,
  height: 250,
};
const shape = {
  id: 'shape',
  generation: 'generation',
  kind: 'shape',
  transform: { x: 4, y: 6, width: 90, height: 80, rotation: 0 },
  style: { stroke: '#000' },
  layer: 'annotation',
  order: 1,
  createdAt: 1,
  updatedAt: 2,
};
const scope = () => ({
  root: 'temporary-project',
  saveScope: 'durable',
  sessionId: 'session',
  epoch: 1,
  viewEpoch: 0,
  canvasId: 'default',
  home: false,
});
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function setup() {
  const events = [],
    errors = [],
    notices = [],
    busy = [];
  let ids = 0;
  const ports = {
    scope: scope(),
    busy: false,
    canEdit: () => true,
    environment: { now: () => 100, id: () => 'id-' + ++ids },
    flush: async (guard) => {
      events.push('flush');
      guard();
    },
    flushDrawings: async () => {
      events.push('drawing-flush');
    },
    reloadDrawings: async () => {
      events.push('drawing-reload');
    },
    submitDrawing: (command) => events.push(['optimistic-drawing', command]),
    reload: async () => {
      events.push('reload');
    },
    notice: (value) => notices.push(value),
    error: (error) => errors.push(error),
    editor: {
      duplicateDocuments: async (input) => {
        events.push(['duplicate', input]);
        return [{ ...doc, id: 'copy' }];
      },
      deleteDocument: async (input) => {
        events.push(['delete', input]);
      },
      deleteDocuments: async (input) => {
        events.push(['delete-many', input]);
      },
      listDocuments: async () => [{ ...doc, revision: 9 }],
      updateLayouts: async (updates) => {
        events.push(['layouts', updates]);
      },
      applyCanvasCommands: async (input) => {
        events.push(['batch', input]);
        return [[{ ...doc, id: 'copy' }]];
      },
    },
    preview: {
      listPreviews: async () => [
        { relativePath: 'output/index.html', revision: 8 },
      ],
    },
  };
  const service = new CanvasSelectionActions(
    () => ports,
    (scope, value) => busy.push([scope, value]),
  );
  return { ports, service, events, errors, notices, busy };
}

test('context selection preserves a selected group, replaces outside targets and snapshots supported kinds', () => {
  const a = {
    id: 'a',
    selected: true,
    data: { kind: 'document', document: { ...doc, id: 'a' } },
  };
  const b = {
    id: 'b',
    selected: true,
    data: {
      kind: 'document',
      document: { ...doc, id: 'b', relativePath: 'ideas/b.md' },
    },
  };
  const outside = {
    id: 'c',
    selected: false,
    data: {
      kind: 'document',
      document: { ...doc, id: 'c', relativePath: 'ideas/c.md' },
    },
  };
  assert.deepEqual(
    contextSelection([a, b, outside], a).map((n) => n.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    contextSelection([a, b, outside], outside).map((n) => n.id),
    ['c'],
  );
  assert.deepEqual(
    contextSelection([a, b, outside]).map((n) => n.id),
    ['a', 'b'],
  );
  const section = {
    id: 's',
    selected: true,
    data: {
      kind: 'section',
      collapsed: false,
      section: {
        id: 's',
        relativePath: 'sections/s.md',
        members: [{ id: 'a', path: doc.relativePath }],
      },
    },
  };
  const targets = selectionMenuTargets([a, b, section]);
  a.data.document.title = 'later';
  assert.notEqual(targets.documents[0].title, 'later');
  assert.deepEqual(selectionMenuPaths(targets), [
    'sections/s.md',
    'ideas/b.md',
  ]);
});

test('bulk colors flush first, keep identities and publish one batch with fresh revisions', async () => {
  const f = setup();
  await f.service.setColors(
    [doc, { relativePath: 'output/index.html' }],
    'pink',
  );
  const batch = f.events.find(
    (event) => Array.isArray(event) && event[0] === 'batch',
  )[1];
  assert.equal(f.events[0], 'flush');
  assert.equal(batch.commands.length, 2);
  assert.equal(batch.commands[0].input.objectId, doc.id);
  assert.deepEqual(
    batch.commands.map((command) => command.input.revision),
    [9, 8],
  );
  assert.equal(f.errors.length, 0);
  const stale = setup();
  stale.ports.editor.listDocuments = async () => [
    { ...doc, id: 'replacement' },
  ];
  await stale.service.setColors([doc], 'pink');
  assert.equal(
    stale.events.some((event) => Array.isArray(event) && event[0] === 'batch'),
    false,
  );
  assert.equal(stale.errors.length, 1);
});

test('arrangement excludes section members by ID/path, uses collapsed displayed height and preserves expanded storage', () => {
  const section = {
    id: 'section',
    relativePath: 'sections/a.md',
    x: 40,
    y: 50,
    width: 600,
    height: 400,
    members: [{ id: 'note', path: 'docs/old.md' }],
  };
  const second = {
    ...doc,
    id: 'second',
    relativePath: 'docs/b.md',
    x: 800,
    y: 600,
    collapsed: true,
  };
  const items = selectionArrangementItems([doc, second], [section]);
  assert.equal(items.length, 2);
  assert.equal(items.find((item) => item.kind === 'document').height, 38);
  const before = structuredClone(items),
    result = arrangeSelectionItems(items, 'bottom');
  assert.equal(result.find((item) => item.kind === 'document').height, 250);
  assert.equal(
    result.find((item) => item.kind === 'section').moveMembers,
    true,
  );
  assert.equal(result.find((item) => item.kind === 'section').y, 238);
  assert.deepEqual(items, before);
});
test('all eight arrangements retain endpoints, centers, stable equal gaps and input data', () => {
  const items = [0, 1, 2].map((n) => ({
    key: String(n),
    kind: 'document',
    relativePath: `docs/${n}.md`,
    x: n * 100,
    y: n * 90,
    width: 40 + n * 10,
    height: 30 + n * 10,
    storedHeight: 300,
  }));
  const original = structuredClone(items);
  for (const action of [
    'left',
    'center-x',
    'right',
    'top',
    'center-y',
    'bottom',
    'distribute-x',
    'distribute-y',
  ]) {
    const result = arrangeSelectionItems(items, action);
    assert.equal(result.length, 3);
    assert.ok(result.every((item) => item.height === 300));
    if (action === 'left') assert.ok(result.every((item) => item.x === 0));
    if (action === 'right')
      assert.ok(result.every((item, i) => item.x + items[i].width === 260));
    if (action === 'center-x')
      assert.ok(result.every((item, i) => item.x + items[i].width / 2 === 130));
    if (action === 'distribute-x')
      assert.equal(
        result[1].x - (result[0].x + 40),
        result[2].x - (result[1].x + 50),
      );
    if (action === 'distribute-y')
      assert.equal(
        result[1].y - (result[0].y + 30),
        result[2].y - (result[1].y + 40),
      );
  }
  assert.deepEqual(items, original);
  assert.throws(
    () => arrangeSelectionItems(items.slice(0, 2), 'distribute-x'),
    /3개/,
  );
});
test('clipboard snapshots and drawing copies preserve originals, fresh identity, timestamp and offsets', () => {
  const original = structuredClone(shape),
    objects = [structuredClone(shape)];
  const copied = copiedSelection([doc], ['note'], objects);
  objects[0].transform.x = 999;
  assert.equal(copied.drawings[0].transform.x, 4);
  let id = 0;
  const [copy] = copyDrawingObjects(copied.drawings, 56, {
    now: () => 100,
    id: () => String(++id),
  });
  assert.deepEqual(
    [
      copy.id,
      copy.generation,
      copy.createdAt,
      copy.updatedAt,
      copy.transform.x,
      copy.transform.y,
    ],
    ['1', '2', 100, 100, 60, 62],
  );
  assert.deepEqual(shape, original);
  assert.deepEqual(copied.documents, [{ id: 'note', path: 'docs/note.md' }]);
});
test('mixed duplicate snapshots selection before flush and publishes one existing batch using the original canvas/scope', async () => {
  const { service, ports, events, busy } = setup(),
    gate = deferred(),
    selected = [{ ...doc }],
    drawings = [structuredClone(shape)];
  ports.flush = async (guard) => {
    await gate.promise;
    guard();
  };
  let acknowledged;
  const pending = service.duplicate(selected, drawings, (value) => {
    acknowledged = value;
  });
  selected[0].id = 'replaced-selection';
  drawings[0].transform.x = 999;
  gate.resolve();
  await pending;
  const batch = events.find((item) => item[0] === 'batch')[1];
  assert.equal(batch.scope, 'durable');
  assert.equal(batch.commands[0].input.documents[0].id, 'note');
  assert.equal(batch.commands[1].input.canvasId, 'default');
  assert.equal(batch.commands[1].input.objects[0].transform.x, 60);
  assert.equal(events.filter((item) => item[0] === 'batch').length, 1);
  assert.equal(acknowledged.created[0].id, 'copy');
  assert.deepEqual(
    busy.map(([, busy]) => busy),
    [true, false],
  );
});
test('drawing-only duplicate retains the optimistic drawing path and document-only duplicate uses the native copy path', async () => {
  const first = setup();
  await first.service.duplicate([], [shape], () =>
    assert.fail('legacy drawing-only path does not select documents'),
  );
  assert.equal(
    first.events.filter((item) => item[0] === 'optimistic-drawing').length,
    1,
  );
  assert.equal(
    first.events.find((item) => item[0] === 'optimistic-drawing')[1].objects[0]
      .transform.x,
    36,
    'drawing-only keyboard duplicate keeps the legacy 32px offset',
  );
  assert.ok(!first.events.some((item) => item[0] === 'batch'));
  const second = setup();
  await second.service.duplicate([doc], [], () => {});
  assert.equal(
    second.events.filter((item) => item[0] === 'duplicate').length,
    1,
  );
  assert.ok(!second.events.some((item) => item[0] === 'batch'));
});
test('double confirmation has one publication; delete refreshes revision but retains the original identity', async () => {
  const { service, ports, events } = setup(),
    gate = deferred();
  ports.flush = async (guard) => {
    await gate.promise;
    guard();
  };
  let count = 0;
  const first = service.deleteOne(
    doc,
    () => count++,
    () => {},
  );
  const second = service.deleteOne(
    doc,
    () => count++,
    () => {},
  );
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(events.filter((item) => item[0] === 'delete').length, 1);
  assert.deepEqual(events.find((item) => item[0] === 'delete')[1], {
    documentId: 'note',
    relativePath: 'docs/note.md',
    revision: 9,
  });
  assert.equal(count, 1);
});
test('mixed deletion remains a single batch with sections, drawings, HTML and current document revisions', async () => {
  const { service, events } = setup();
  let acknowledged = 0;
  await service.deleteMany(
    {
      documents: [doc, { id: 'html', relativePath: 'output/index.html' }],
      sections: [
        {
          id: 'section',
          relativePath: 'sections/a.md',
          members: [{ id: 'member', path: 'docs/member.md' }],
        },
      ],
      drawings: [shape],
    },
    () => acknowledged++,
  );
  const batch = events.find((item) => item[0] === 'batch')[1];
  assert.equal(batch.commands.length, 3);
  assert.deepEqual(
    batch.commands[0].input.documents.map((doc) => doc.revision),
    [9, 8],
  );
  assert.equal(batch.commands[1].input.deleteMembers, true);
  assert.deepEqual(batch.commands[2].input.targets, [
    { id: 'shape', generation: 'generation' },
  ]);
  assert.equal(acknowledged, 1);
});
test('project/session/canvas changes during flush or fresh reads prevent any later publication or acknowledgement', async () => {
  for (const stage of ['flush', 'read'])
    for (const change of [
      'root',
      'sessionId',
      'epoch',
      'canvasId',
      'viewEpoch',
      'home',
    ]) {
      const { service, ports, events, errors, notices } = setup(),
        gate = deferred();
      if (stage === 'flush') ports.flush = async () => gate.promise;
      else
        ports.editor.listDocuments = async () => {
          await gate.promise;
          return [doc];
        };
      const pending = service.deleteOne(
        doc,
        () => assert.fail('stale acknowledgement'),
        () => assert.fail('stale dialog close'),
      );
      await Promise.resolve();
      ports.scope = {
        ...ports.scope,
        [change]:
          change === 'home'
            ? true
            : change === 'epoch' || change === 'viewEpoch'
              ? 2
              : 'changed',
      };
      gate.resolve();
      await pending;
      assert.ok(!events.some((item) => item[0] === 'delete'));
      assert.deepEqual(errors, []);
      assert.deepEqual(notices, []);
    }
});
test('an in-flight committed response does not reload, clear selection or report errors in another view', async () => {
  const { service, ports, events, errors, notices } = setup(),
    gate = deferred(),
    entered = deferred();
  ports.editor.duplicateDocuments = async () => {
    entered.resolve();
    await gate.promise;
    return [doc];
  };
  const pending = service.duplicate([doc], [], () =>
    assert.fail('late selection'),
  );
  await entered.promise;
  ports.scope = { ...ports.scope, viewEpoch: 2 };
  gate.resolve();
  await pending;
  assert.ok(!events.includes('reload'));
  assert.deepEqual(errors, []);
  assert.deepEqual(notices, []);
});
test('failed publication leaves batch confirmation available and cannot acknowledge success; failed flush cannot publish', async () => {
  for (const stage of ['flush', 'publish']) {
    const { service, ports, events, errors, notices, busy } = setup();
    if (stage === 'flush')
      ports.flush = async () => {
        throw Error(stage);
      };
    else
      ports.editor.deleteDocuments = async () => {
        throw Error(stage);
      };
    await service.deleteMany(
      { documents: [doc], sections: [], drawings: [] },
      () => assert.fail('failure acknowledgement'),
    );
    assert.equal(errors.length, 1);
    assert.deepEqual(notices, []);
    assert.ok(!events.includes('reload'));
    assert.equal(busy.at(-1)[1], false);
  }
});
test('permission/AI protections are checked again after flush and include section members', async () => {
  const { service, ports, events, errors } = setup();
  let allowed = true,
    protectedPaths;
  ports.canEdit = (paths) => {
    protectedPaths = paths;
    return allowed;
  };
  ports.flush = async () => {
    allowed = false;
  };
  await service.deleteMany(
    {
      documents: [doc],
      sections: [
        {
          relativePath: 'sections/a.md',
          members: [{ path: 'docs/member.md' }],
        },
      ],
      drawings: [],
    },
    () => assert.fail('blocked acknowledgement'),
  );
  assert.ok(protectedPaths.includes('docs/member.md'));
  assert.ok(!events.some((item) => item[0] === 'batch'));
  assert.deepEqual(errors, []);
});
test('arrangement waits for flush and emits the original stored heights; disposal suppresses pending work', async () => {
  const first = setup();
  const items = selectionArrangementItems(
    [
      doc,
      {
        ...doc,
        id: 'other',
        relativePath: 'docs/other.md',
        y: 600,
        collapsed: true,
      },
    ],
    [],
  );
  await first.service.arrange(items, 'bottom', [
    'docs/note.md',
    'docs/other.md',
  ]);
  assert.equal(first.events[0], 'flush');
  assert.ok(
    first.events
      .find((item) => item[0] === 'layouts')[1]
      .every((item) => item.height === 250),
  );
  const second = setup(),
    gate = deferred();
  second.ports.flush = async () => gate.promise;
  const pending = second.service.duplicate([doc], [], () =>
    assert.fail('disposed'),
  );
  second.service.dispose();
  gate.resolve();
  await pending;
  assert.ok(!second.events.some((item) => item[0] === 'duplicate'));
});
