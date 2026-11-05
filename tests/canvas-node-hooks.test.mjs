import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useCanvasNodes } from '../src/ui/canvas/useCanvasNodes.ts';
import { StaleCanvasNodeError } from '../src/ui/canvas/node-model.ts';

const noop = () => {};
const asyncNoop = async () => {};
const scope = {
  root: 'a',
  saveScope: 'local:a',
  sessionId: 'session-a',
  epoch: 1,
  canvasId: 'default',
  home: false,
  viewEpoch: 1,
};
const doc = (id) => ({
  id,
  title: id,
  body: '## content',
  relativePath: `docs/${id}.md`,
  type: 'idea',
  status: 'draft',
  x: 20,
  y: 30,
  width: 400,
  height: 300,
  collapsed: false,
  sources: [],
  modifiedAt: 1,
});
function ports(overrides = {}) {
  return {
    selectionScope: scope,
    workspace: {
      root: 'a',
      saveScope: 'local:a',
      session: { sessionId: 'session-a' },
    },
    sections: [],
    activeCanvas: 'default',
    sectionCollapsed: () => false,
    sectionLocked: () => false,
    toggleSection: asyncNoop,
    resizeSection: asyncNoop,
    revealSection: asyncNoop,
    documents: [doc('a'), doc('b')],
    collaboration: { active: false, locks: [], connected: false },
    pathLocked: () => false,
    newFileNodes: new Set(),
    findOpen: false,
    temporaryDocuments: [],
    projectAiQueue: [],
    propertyVisibilityFor: () => ({}),
    personalScope: 'a',
    statusSettings: { value: {}, raw: null },
    workflowBusy: false,
    workflowEditable: true,
    workflowReason: '',
    setWorkflow: noop,
    setStatusManagerOpen: noop,
    aiFileLock: { paths: [], folders: [] },
    setBlockedMessage: noop,
    locked: false,
    onBlocked: noop,
    saveDocument: asyncNoop,
    resizeDocument: asyncNoop,
    focusSource: noop,
    copyTask: asyncNoop,
    revealDocument: asyncNoop,
    setInspectorId: noop,
    collapseActions: { document: asyncNoop },
    previews: [],
    previewWindows: {},
    workflowChange: asyncNoop,
    showError: (error) => {
      throw error;
    },
    aiBusy: false,
    updatePreviewWindow: asyncNoop,
    openHistory: noop,
    setCompareFirst: noop,
    canWriteAiRequest: true,
    initializeAiRequest: noop,
    activeCanvasRef: { current: 'default' },
    drawing: {
      items: [],
      flush: asyncNoop,
      submit: asyncNoop,
      reload: asyncNoop,
    },
    setDrawingGesture: noop,
    submitDrawing: noop,
    setTool: noop,
    kanbanPreferences: { enabled: false, placed: false },
    kanbanDocuments: [],
    kanbanView: { value: {} },
    kanbanViewError: '',
    openKanbanControls: noop,
    updateKanbanPreferences: noop,
    moveKanbanCard: asyncNoop,
    navigateCanvasItem: { current: noop },
    gameUi: {
      frames: [],
      savingFrameIds: new Set(),
      saving: false,
      error: '',
      retry: noop,
      submit: asyncNoop,
    },
    gameUiSettings: { enabled: true },
    flushEditors: asyncNoop,
    loadProject: asyncNoop,
    api: {
      editor: {
        applyDrawingCommand: asyncNoop,
        applyCanvasCommands: asyncNoop,
      },
    },
    pendingGeometry: { current: new Map() },
    createdDrawingSelection: { current: null },
    beginEdit: asyncNoop,
    endEdit: asyncNoop,
    registerEditor: noop,
    draftRegistry: {},
    reportEdit: noop,
    ...overrides,
  };
}
async function mount(t, initial) {
  const dom = new JSDOM('<div id="root"></div>');
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  let nodes, setNodes, root;
  function Fixture({ input }) {
    [nodes, setNodes] = useState([]);
    useCanvasNodes(input.selectionScope, () => ({ ...input, setNodes }), [
      input,
    ]);
    return null;
  }
  const render = async (input) =>
    act(async () =>
      root.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(Fixture, { input }),
        ),
      ),
    );
  await act(async () => {
    root = createRoot(dom.window.document.getElementById('root'));
  });
  await render(initial);
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of saved)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
  });
  return {
    get nodes() {
      return nodes;
    },
    render,
    mutate: async (action) => act(async () => setNodes(action)),
  };
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('actual node hook preserves untouched data and callbacks, updates the changed document and current handlers', async (t) => {
  const input = ports();
  Object.defineProperty(input.documents[1], 'toJSON', {
    value: () => {
      throw Error('full node serialization');
    },
  });
  const app = await mount(t, input),
    before = app.nodes;
  const commands = [];
  const changed = {
    ...input,
    documents: [
      { ...input.documents[0], body: 'changed', revision: 2 },
      input.documents[1],
    ],
    setWorkflow: (document, status) => commands.push({ document, status }),
  };
  await app.render(changed);
  assert.notEqual(app.nodes[0].data, before[0].data);
  assert.equal(app.nodes[1], before[1]);
  assert.equal(app.nodes[0].data.onWorkflow, before[0].data.onWorkflow);
  before[0].data.onWorkflow('done');
  assert.equal(commands[0].document, changed.documents[0]);
  assert.equal(commands[0].status, 'done');
  assert.equal(Object.hasOwn(app.nodes[0].data, 'sourceTitles'), false);
  const stable = app.nodes;
  await app.render({
    ...changed,
    collaboration: { ...changed.collaboration },
    propertyVisibilityFor: () => ({}),
  });
  assert.equal(
    app.nodes,
    stable,
    'heartbeat and fresh empty property records preserve the entire projection',
  );
});

test('measured dimensions, live dragging and pending geometry survive updates while locks and hidden sections take effect', async (t) => {
  const input = ports(),
    app = await mount(t, input),
    measured = { width: 410, height: 310 };
  await app.mutate((nodes) =>
    nodes.map((node, index) =>
      index
        ? node
        : {
            ...node,
            measured,
            dragging: true,
            position: { x: 100, y: 200 },
            style: { width: 440, height: 330 },
          },
    ),
  );
  const changed = {
    ...input,
    documents: [{ ...input.documents[0], x: 900, y: 800 }, input.documents[1]],
  };
  await app.render(changed);
  assert.deepEqual(app.nodes[0].position, { x: 100, y: 200 });
  assert.equal(app.nodes[0].measured, measured);
  await app.render({ ...changed, pathLocked: () => true });
  assert.deepEqual(app.nodes[0].position, { x: 900, y: 800 });
  assert.equal(app.nodes[0].data.locked, true);
  const pending = {
    ...input,
    pendingGeometry: {
      current: new Map([
        [
          'a',
          { position: { x: 700, y: 600 }, style: { width: 500, height: 400 } },
        ],
      ]),
    },
  };
  await app.render(pending);
  assert.deepEqual(app.nodes[0].position, { x: 700, y: 600 });
  await app.mutate((nodes) =>
    nodes.map((node) => ({ ...node, selected: true })),
  );
  await app.render({
    ...input,
    sections: [
      {
        id: 'section',
        x: 10,
        y: 20,
        width: 1000,
        height: 1000,
        members: [{ id: 'a' }],
      },
    ],
    sectionCollapsed: () => true,
  });
  assert.equal(app.nodes.find((node) => node.id === 'a').selected, false);
  assert.equal(
    app.nodes.find((node) => node.id === 'a').data.sectionHidden,
    true,
  );
});

test('game UI save waiting for editor flush cannot publish into another project visit', async (t) => {
  const gate = deferred(),
    commands = [];
  const frame = {
    id: 'f',
    generation: 'g',
    canvasId: 'default',
    x: 10,
    y: 20,
    width: 400,
    viewportWidth: 1280,
    viewportHeight: 720,
    items: [],
  };
  const input = ports({ flushEditors: () => gate.promise });
  input.gameUi = {
    ...input.gameUi,
    frames: [frame],
    submit: async (command) => commands.push(command),
  };
  const app = await mount(t, input);
  const old = app.nodes.find((node) => node.data.kind === 'game-ui').data;
  const saving = old.submit({ action: 'frame', id: 'f' });
  const rejected = assert.rejects(saving, StaleCanvasNodeError);
  await app.render({ ...input, selectionScope: { ...scope, viewEpoch: 2 } });
  gate.resolve();
  await rejected;
  assert.deepEqual(commands, []);
  await assert.rejects(
    old.submit({ action: 'frame', id: 'f' }),
    StaleCanvasNodeError,
  );
});

test('text saves and conditional deletes waiting for drawing flush keep their failure and do not write after a scope change', async (t) => {
  const gate = deferred(),
    writes = [];
  const input = ports();
  input.drawing = {
    ...input.drawing,
    items: [
      {
        id: 'text',
        canvasId: 'default',
        generation: 'g',
        kind: 'text',
        transform: { x: 1, y: 2, width: 200, height: 100, rotation: 0 },
        style: {},
        geometry: {},
      },
    ],
    flush: () => gate.promise,
  };
  input.api = {
    editor: {
      applyDrawingCommand: async (command) => writes.push(command),
      applyCanvasCommands: async (command) => writes.push(command),
    },
  };
  const app = await mount(t, input),
    data = app.nodes.find((node) => node.data.kind === 'drawing').data;
  const saving = assert.rejects(
    data.onSave({ id: 'text' }),
    StaleCanvasNodeError,
  );
  const deleting = assert.rejects(
    data.onCommand({
      action: 'delete',
      targets: [{ id: 'text', expectedGeometry: {} }],
    }),
    StaleCanvasNodeError,
  );
  await app.render({
    ...input,
    selectionScope: { ...scope, canvasId: 'other', viewEpoch: 2 },
    activeCanvas: 'other',
  });
  gate.resolve();
  await Promise.all([saving, deleting]);
  assert.deepEqual(writes, []);
});

test('only the queued game UI frame changes its saving indication', async (t) => {
  const input = ports();
  const frame = (id) => ({
    id,
    generation: id,
    canvasId: 'default',
    x: 10,
    y: 20,
    width: 400,
    viewportWidth: 1280,
    viewportHeight: 720,
    items: [],
  });
  input.gameUi = { ...input.gameUi, frames: [frame('f'), frame('other')] };
  const app = await mount(t, input),
    before = app.nodes;
  await app.render({
    ...input,
    gameUi: { ...input.gameUi, saving: true, savingFrameIds: new Set(['f']) },
  });
  assert.equal(app.nodes[0].data.saving, true);
  assert.equal(app.nodes[1].data.saving, false);
  assert.equal(app.nodes[1], before[1]);
});
