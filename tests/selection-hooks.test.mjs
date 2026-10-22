import { useCollapseActions } from '../src/ui/canvas/useCollapseActions.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  useSectionActions,
  useSectionPrompts,
} from '../src/ui/canvas/useSectionActions.ts';
import {
  useSelectionScope,
  useSelectionDeletePrompts,
  useSelectionActions,
  useCreatedSelection,
} from '../src/ui/canvas/useSelectionActions.ts';

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const initial = {
  root: 'a',
  saveScope: 'scope-a',
  sessionId: 's-a',
  epoch: 1,
  canvasId: 'default',
  home: false,
};
const doc = { id: 'note', relativePath: 'docs/note.md', title: '원본' };
async function setup(t, gates = {}) {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const previous = new Map(
    ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  });
  let latest, root;
  function Fixture({ input }) {
    const scope = useSelectionScope(input),
      prompts = useSelectionDeletePrompts(scope);
    const [nodes, setNodes] = React.useState([]);
    const selectCreated = useCreatedSelection(scope, nodes, setNodes);
    const sections = useSectionPrompts(scope);
    const sectionCommand = useSectionActions(scope, () => ({
      busy: false,
      canEdit: () => true,
      editor: {
        createSection: async () => {
          await gates[input.root]?.promise;
          return { id: input.root, title: input.root, members: [] };
        },
      },
      reload: async () => {},
      notice: () => {},
      error: (error) => {
        throw error;
      },
    }));
    const collapseCommand = useCollapseActions(scope, () => ({
      busy: false,
      canCollapse: () => true,
      editor: {},
      flush: async (guard) => {
        await gates[input.root]?.promise;
        guard();
      },
      sectionViews: () => {},
      clearTemporarySections: () => {},
      selectCollapsedSection: () => {},
      reload: async () => {},
      notice: () => {},
      error: (error) => {
        throw error;
      },
    }));
    const command = useSelectionActions(scope, () => ({
      busy: false,
      canEdit: () => true,
      environment: { now: () => 1, id: () => 'id' },
      editor: { duplicateDocuments: async () => [doc] },
      preview: {},
      flush: async (guard) => {
        await gates[input.root]?.promise;
        guard();
      },
      flushDrawings: async () => {},
      reloadDrawings: async () => {},
      submitDrawing: () => {},
      reload: async () => {},
      notice: () => {},
      error: (error) => {
        throw error;
      },
    }));
    latest = {
      scope,
      ...prompts,
      ...command,
      nodes,
      setNodes,
      selectCreated,
      sections,
      sectionCommand,
      collapseCommand,
    };
    return null;
  }
  const render = async (input) =>
    act(async () => {
      root.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(Fixture, { input }),
        ),
      );
    });
  await act(async () => {
    root = createRoot(dom.window.document.getElementById('root'));
  });
  await render(initial);
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, value] of previous) {
      if (value) Object.defineProperty(globalThis, key, value);
      else delete globalThis[key];
    }
  });
  return {
    get current() {
      return latest;
    },
    render,
  };
}
test('confirmation scope expires across canvas round trips and old callbacks cannot clear a newer prompt', async (t) => {
  const ui = await setup(t),
    original = ui.current.scope;
  await act(async () => ui.current.setDeletePrompt(doc));
  const oldSet = ui.current.setDeletePrompt;
  assert.equal(ui.current.deletePrompt.id, 'note');
  await ui.render({ ...initial, canvasId: 'second' });
  assert.equal(ui.current.deletePrompt, null);
  await act(async () => ui.current.setDeletePrompt({ ...doc, id: 'new' }));
  await act(async () => oldSet(null));
  assert.equal(ui.current.deletePrompt.id, 'new');
  await ui.render(initial);
  assert.equal(ui.current.deletePrompt, null);
  assert.ok(ui.current.scope.viewEpoch > original.viewEpoch);
});

test('created selection waits for delayed mixed nodes once and expires on a canvas round trip', async (t) => {
  const ui = await setup(t);
  await act(async () => ui.current.selectCreated(['copy', 'drawing:new']));
  await act(async () =>
    ui.current.setNodes([{ id: 'old', selected: true }, { id: 'copy' }]),
  );
  assert.ok(!ui.current.nodes.find((node) => node.id === 'copy').selected);
  await act(async () =>
    ui.current.setNodes((current) => [...current, { id: 'drawing:new' }]),
  );
  assert.deepEqual(
    ui.current.nodes.filter((node) => node.selected).map((node) => node.id),
    ['copy', 'drawing:new'],
  );
  await act(async () =>
    ui.current.setNodes((current) =>
      current.map((node) => ({ ...node, selected: false })),
    ),
  );
  assert.ok(
    ui.current.nodes.every((node) => !node.selected),
    'later user selection is not overwritten',
  );
  const oldSelect = ui.current.selectCreated;
  await act(async () => ui.current.selectCreated(['later']));
  await ui.render({ ...initial, canvasId: 'other' });
  await act(async () => {
    oldSelect(['copy']);
    ui.current.setNodes([{ id: 'later' }, { id: 'copy' }]);
  });
  assert.ok(ui.current.nodes.every((node) => !node.selected));
  await ui.render(initial);
  assert.ok(ui.current.nodes.every((node) => !node.selected));
});
test('StrictMode services remain active and late busy completion from another project cannot unlock a new operation', async (t) => {
  const a = deferred(),
    b = deferred(),
    ui = await setup(t, { a, b });
  let pendingA,
    pendingB,
    ack = 0;
  await act(async () => {
    pendingA = ui.current.actions.duplicate([doc], [], () =>
      assert.fail('old acknowledgement'),
    );
  });
  assert.equal(ui.current.busy, true);
  await ui.render({ ...initial, root: 'b', sessionId: 's-b' });
  assert.equal(ui.current.busy, false);
  await act(async () => {
    pendingB = ui.current.actions.duplicate([doc], [], () => ack++);
  });
  assert.equal(ui.current.busy, true);
  await act(async () => {
    a.resolve();
    await pendingA;
  });
  assert.equal(ui.current.busy, true);
  await act(async () => {
    b.resolve();
    await pendingB;
  });
  assert.equal(ui.current.busy, false);
  assert.equal(ack, 1);
});

test('section creation, membership and destructive prompts expire together and old setters cannot dismiss replacements', async (t) => {
  const ui = await setup(t);
  const previous = ui.current.sections;
  await act(async () => {
    previous.setCreatePrompt({ title: 'old', documents: [doc] });
    previous.setMembershipPrompt({ document: doc });
    previous.setSectionActionPrompt({
      section: { id: 's' },
      deleteMembers: true,
    });
  });
  await ui.render({ ...initial, canvasId: 'other' });
  assert.equal(ui.current.sections.createPrompt, null);
  assert.equal(ui.current.sections.membershipPrompt, null);
  assert.equal(ui.current.sections.sectionActionPrompt, null);
  await ui.render(initial);
  await act(async () => {
    ui.current.sections.setCreatePrompt({ title: 'new', documents: [] });
    previous.setCreatePrompt(null);
    previous.setMembershipPrompt({ document: doc });
    previous.setSectionActionPrompt({
      section: { id: 'stale' },
      deleteMembers: true,
    });
  });
  assert.equal(ui.current.sections.createPrompt.title, 'new');
  assert.equal(ui.current.sections.membershipPrompt, null);
  assert.equal(ui.current.sections.sectionActionPrompt, null);
});
test('section busy state is scoped and an old receipt cannot release another view operation', async (t) => {
  const a = deferred(),
    b = deferred(),
    ui = await setup(t, { a, b });
  let first, second;
  await act(async () => {
    first = ui.current.sectionCommand.actions.create(
      {
        title: 'first',
        documents: [{ ...doc, x: 0, y: 0, width: 340, height: 300 }],
      },
      () => {},
    );
  });
  assert.equal(ui.current.sectionCommand.busy, true);
  await ui.render({ ...initial, root: 'b', sessionId: 'b' });
  assert.equal(ui.current.sectionCommand.busy, false);
  await act(async () => {
    second = ui.current.sectionCommand.actions.create(
      {
        title: 'second',
        documents: [{ ...doc, x: 0, y: 0, width: 340, height: 300 }],
      },
      () => {},
    );
  });
  assert.equal(ui.current.sectionCommand.busy, true);
  await act(async () => {
    a.resolve();
    await first;
  });
  assert.equal(ui.current.sectionCommand.busy, true);
  await act(async () => {
    b.resolve();
    await second;
  });
  assert.equal(ui.current.sectionCommand.busy, false);
});

test('section rename state expires on a canvas round trip and an old completion cannot close a newer title', async (t) => {
  const ui = await setup(t);
  const old = ui.current.sections.setSectionRename;
  await act(async () => old({ section: { id: 's' }, title: 'old' }));
  await ui.render({ ...initial, canvasId: 'other' });
  assert.equal(ui.current.sections.sectionRename, null);
  await ui.render(initial);
  await act(async () => {
    ui.current.sections.setSectionRename({
      section: { id: 'new' },
      title: 'new',
    });
    old(null);
  });
  assert.equal(ui.current.sections.sectionRename.title, 'new');
});
test('collapse StrictMode busy and delayed editor flush remain attached to the originating view', async (t) => {
  const a = deferred(),
    b = deferred(),
    ui = await setup(t, { a, b });
  let first, second;
  const section = { id: 's', relativePath: 'sections/s.md', members: [] };
  await act(async () => {
    first = ui.current.collapseCommand.actions.section(section, false);
  });
  assert.equal(ui.current.collapseCommand.busy, true);
  await ui.render({ ...initial, root: 'b', sessionId: 'b' });
  await act(async () => {
    second = ui.current.collapseCommand.actions.section(section, false);
  });
  assert.equal(ui.current.collapseCommand.busy, true);
  await act(async () => {
    a.resolve();
    await first;
  });
  assert.equal(ui.current.collapseCommand.busy, true);
  await act(async () => {
    b.resolve();
    await second;
  });
  assert.equal(ui.current.collapseCommand.busy, false);
});
