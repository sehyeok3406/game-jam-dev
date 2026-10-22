import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CanvasSectionActions,
  sectionCreationInput,
} from '../src/ui/canvas/section-actions.ts';

const doc = {
  id: 'a',
  relativePath: 'docs/a.md',
  title: '원문',
  revision: 3,
  x: 10,
  y: 20,
  width: 340,
  height: 300,
};
const section = {
  id: 's',
  relativePath: 'sections/s.md',
  title: '섹션',
  revision: 7,
  members: [{ id: 'a', path: 'docs/a.md' }],
};
const membership = () => ({
  document: { ...doc },
  fromSection: structuredClone(section),
  toSection: null,
  x: 8,
  y: 9,
  width: 340,
  height: 300,
});
const scope = () => ({
  root: 'temp',
  saveScope: 'durable',
  canvasId: 'default',
  sessionId: 'session',
  epoch: 1,
  viewEpoch: 0,
  home: false,
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}
function setup() {
  const events = [],
    errors = [],
    notices = [],
    busy = [];
  const ports = {
    scope: scope(),
    busy: false,
    canEdit: (paths) => {
      events.push(['permission', paths]);
      return true;
    },
    editor: {
      renameSection: async (...input) => {
        events.push(['rename', input]);
      },
      createSection: async (input) => {
        events.push(['create', input]);
        return structuredClone(section);
      },
      deleteSection: async (input) => {
        events.push(['delete', input]);
        return { deletedDocumentCount: 1, preservedDocumentCount: 0 };
      },
      moveDocumentToSection: async (input) => {
        events.push(['move', input]);
      },
    },
    reload: async () => {
      events.push('reload');
    },
    notice: (n) => notices.push(n),
    error: (e) => errors.push(e),
  };
  return {
    ports,
    events,
    errors,
    notices,
    busy,
    service: new CanvasSectionActions(
      () => ports,
      (s, b) => busy.push([s, b]),
    ),
  };
}
test('section creation keeps legacy bounds, expanded height, captured members and default title', async () => {
  const source = [
    structuredClone(doc),
    {
      ...doc,
      id: 'b',
      relativePath: 'docs/b.md',
      collapsed: true,
      x: 500,
      y: 400,
    },
  ];
  const before = structuredClone(source);
  const input = sectionCreationInput(source, '  ', 'other');
  assert.deepEqual(input, {
    canvasId: 'other',
    title: '새 섹션',
    x: -38,
    y: -52,
    width: 926,
    height: 800,
    members: [
      { id: 'a', path: 'docs/a.md' },
      { id: 'b', path: 'docs/b.md' },
    ],
  });
  assert.deepEqual(source, before);
  assert.equal(sectionCreationInput([], 'empty', 'default'), null);
  const h = setup();
  let accepted;
  await h.service.create({ documents: source, title: ' 새 이름 ' }, (value) => {
    accepted = value;
    h.events.push('accepted');
  });
  assert.equal(h.events.find((e) => e[0] === 'create')[1].title, '새 이름');
  assert.ok(h.events.indexOf('reload') < h.events.indexOf('accepted'));
  assert.equal(accepted.id, 's');
  assert.equal(h.notices.length, 1);
});
test('section delete and ungroup preserve original ID, revision, flag and member protection', async () => {
  for (const deleteMembers of [false, true]) {
    const h = setup();
    let accepted = 0;
    await h.service.remove({ section, deleteMembers }, () => accepted++);
    assert.deepEqual(h.events.find((e) => e[0] === 'delete')[1], {
      sectionId: 's',
      relativePath: 'sections/s.md',
      revision: 7,
      deleteMembers,
    });
    assert.deepEqual(h.events[0][1], ['sections/s.md', 'docs/a.md']);
    assert.equal(accepted, 1);
    assert.equal(h.errors.length, 0);
    assert.match(
      h.notices[0],
      deleteMembers ? /파일 1개를 휴지통/ : /파일 1개는 그대로/,
    );
  }
});
test('membership add, transfer and removal keep drag revision and coordinates', async () => {
  for (const [from, to, message] of [
    [null, section, '추가'],
    [
      section,
      {
        ...section,
        id: 'next',
        title: '다음',
        relativePath: 'sections/next.md',
      },
      '옮겼',
    ],
    [section, null, '제외'],
  ]) {
    const h = setup(),
      prompt = { ...membership(), fromSection: from, toSection: to };
    let accepted = 0;
    await h.service.membership(prompt, () => accepted++);
    assert.deepEqual(h.events.find((e) => e[0] === 'move')[1], {
      documentId: 'a',
      documentPath: 'docs/a.md',
      revision: 3,
      targetSectionId: to?.id ?? null,
      x: 8,
      y: 9,
      width: 340,
      height: 300,
    });
    assert.ok(h.events[0][1].includes('docs/a.md'));
    for (const s of [from, to].filter(Boolean))
      assert.ok(h.events[0][1].includes(s.relativePath));
    assert.equal(accepted, 1);
    assert.match(h.notices[0], new RegExp(message));
  }
});
test('membership cancellation remains read-only and works after role loss', async () => {
  const h = setup();
  h.ports.canEdit = () => false;
  let accepted = 0;
  await h.service.membership(membership(), () => accepted++, true);
  assert.equal(accepted, 1);
  assert.deepEqual(h.events, ['reload']);
  assert.match(h.notices[0], /취소/);
});
test('double confirm is gated synchronously and pending inputs are snapshots', async () => {
  const h = setup(),
    gate = deferred(),
    prompt = { section: structuredClone(section), deleteMembers: true };
  let calls = 0,
    accepted = 0;
  h.ports.editor.deleteSection = async (input) => {
    calls++;
    await gate.promise;
    assert.equal(input.sectionId, 's');
    return { deletedDocumentCount: 1 };
  };
  const pending = h.service.remove(prompt, () => accepted++);
  prompt.section.id = 'changed';
  prompt.section.members.length = 0;
  await h.service.remove(prompt, () => accepted++);
  assert.equal(calls, 1);
  gate.resolve();
  await pending;
  assert.equal(accepted, 1);
  assert.deepEqual(
    h.busy.map(([, b]) => b),
    [true, false],
  );
});
test('pending replies and failures cannot affect another activation, home or round trip', async () => {
  for (const mode of [
    'canvas',
    'session',
    'epoch',
    'home',
    'roundtrip',
    'dispose',
  ])
    for (const fail of [false, true]) {
      const h = setup(),
        gate = deferred();
      let accepted = 0;
      h.ports.editor.moveDocumentToSection = () => gate.promise;
      const pending = h.service.membership(membership(), () => accepted++);
      if (mode === 'canvas') h.ports.scope.canvasId = 'other';
      if (mode === 'session') h.ports.scope.sessionId = 'next';
      if (mode === 'epoch') h.ports.scope.epoch++;
      if (mode === 'home') h.ports.scope.home = true;
      if (mode === 'roundtrip') h.ports.scope.viewEpoch += 2;
      if (mode === 'dispose') h.service.dispose();
      if (fail) gate.reject(Error('late'));
      else gate.resolve();
      await pending;
      assert.equal(accepted, 0);
      assert.equal(h.notices.length, 0);
      assert.equal(h.errors.length, 0);
      assert.ok(!h.events.includes('reload'));
    }
});
test('scope change during reload suppresses creation selection and success notice', async () => {
  const h = setup(),
    gate = deferred();
  let accepted = 0;
  h.ports.reload = () => gate.promise;
  const pending = h.service.create(
    { documents: [doc], title: 'name' },
    () => accepted++,
  );
  await Promise.resolve();
  h.ports.scope.canvasId = 'other';
  gate.resolve();
  await pending;
  assert.equal(accepted, 0);
  assert.equal(h.notices.length, 0);
});
test('failed writes close the matching delete/membership confirmation and membership reloads', async () => {
  for (const operation of ['remove', 'membership', 'create']) {
    const h = setup();
    let accepted = 0;
    const error = Error('conflict');
    for (const method of Object.keys(h.ports.editor))
      h.ports.editor[method] = async () => {
        throw error;
      };
    const prompt =
      operation === 'remove'
        ? { section, deleteMembers: false }
        : operation === 'membership'
          ? membership()
          : { documents: [doc], title: 'name' };
    await h.service[operation](prompt, () => accepted++);
    assert.equal(accepted, operation === 'create' ? 0 : 1);
    assert.deepEqual(h.errors, [error]);
    assert.equal(h.notices.length, 0);
    assert.equal(h.events.includes('reload'), operation === 'membership');
  }
});
test('home, missing root, busy, role/AI protection and final permission checks prevent writes', async () => {
  for (const reason of [
    'home',
    'root',
    'busy',
    'permission',
    'recheck',
    'dispose',
  ]) {
    const h = setup();
    let checks = 0;
    if (reason === 'home') h.ports.scope.home = true;
    if (reason === 'root') h.ports.scope.root = null;
    if (reason === 'busy') h.ports.busy = true;
    if (reason === 'dispose') h.service.dispose();
    if (reason === 'permission') h.ports.canEdit = () => false;
    if (reason === 'recheck') h.ports.canEdit = () => ++checks === 1;
    await h.service.remove({ section, deleteMembers: true }, () =>
      assert.fail('acknowledged'),
    );
    assert.equal(h.events.filter((e) => e[0] === 'delete').length, 0);
    assert.equal(h.errors.length, 0);
  }
});

test('reload failure after a committed command acknowledges once without retrying the write', async () => {
  for (const operation of ['remove', 'membership']) {
    const h = setup(),
      error = Error('reload failed');
    let accepted = 0;
    h.ports.reload = async () => {
      h.events.push('reload');
      throw error;
    };
    await h.service[operation](
      operation === 'remove' ? { section, deleteMembers: false } : membership(),
      () => accepted++,
    );
    assert.equal(accepted, 1);
    assert.equal(h.events.filter((event) => event === 'reload').length, 1);
    assert.equal(
      h.events.filter(
        (event) => event[0] === (operation === 'remove' ? 'delete' : 'move'),
      ).length,
      1,
    );
    assert.deepEqual(h.errors, [error]);
    assert.equal(h.notices.length, 0);
  }
});

test('section rename keeps the original path/revision and title, closes once and never retries a failed reload', async () => {
  const h = setup();
  let accepted = 0;
  await h.service.rename({ section, title: ' 새 제목 ' }, () => accepted++);
  assert.deepEqual(h.events.find((e) => e[0] === 'rename')[1], [
    'sections/s.md',
    ' 새 제목 ',
    7,
  ]);
  assert.equal(accepted, 1);
  assert.ok(h.events.includes('reload'));
  const failed = setup();
  failed.ports.reload = async () => {
    throw Error('read failed');
  };
  await failed.service.rename({ section, title: 'changed' }, () => {});
  assert.equal(failed.events.filter((e) => e[0] === 'rename').length, 1);
  assert.equal(failed.errors.length, 1);
  const empty = setup();
  await empty.service.rename({ section, title: '  ' }, () => assert.fail());
  assert.equal(empty.events.length, 0);
});
test('section rename double activation and late receipts cannot dismiss another activation', async () => {
  const h = setup(),
    gate = deferred();
  let accepted = 0;
  h.ports.editor.renameSection = async (...input) => {
    h.events.push(['rename', input]);
    await gate.promise;
  };
  const prompt = { section: structuredClone(section), title: 'first' },
    pending = h.service.rename(prompt, () => accepted++);
  prompt.title = 'second';
  prompt.section.relativePath = 'sections/replaced.md';
  await h.service.rename(prompt, () => accepted++);
  h.ports.scope.viewEpoch += 2;
  gate.resolve();
  await pending;
  assert.equal(h.events.filter((e) => e[0] === 'rename').length, 1);
  assert.equal(accepted, 0);
  assert.equal(h.errors.length, 0);
  assert.ok(!h.events.includes('reload'));
});
test('rename conflicts retain confirmation and protected sections never publish', async () => {
  const h = setup(),
    error = Error('revision conflict');
  h.ports.editor.renameSection = async () => {
    throw error;
  };
  await h.service.rename({ section, title: 'new' }, () =>
    assert.fail('closed on failure'),
  );
  assert.deepEqual(h.errors, [error]);
  assert.ok(!h.events.includes('reload'));
  const denied = setup();
  denied.ports.canEdit = () => false;
  await denied.service.rename({ section, title: 'new' }, () => assert.fail());
  assert.ok(!denied.events.some((e) => e[0] === 'rename'));
});
