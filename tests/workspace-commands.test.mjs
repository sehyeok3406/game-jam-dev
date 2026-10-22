import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  documentDragLayout,
  documentMembership,
} from '../src/ui/canvas/geometry-plan.ts';
import { canvasTransferPlan } from '../src/ui/canvas/transfer-plan.ts';
import { useCanvasGeometry } from '../src/ui/canvas/useCanvasGeometry.ts';
import { useCanvasNavigation } from '../src/ui/canvas/useCanvasNavigation.ts';
import { useWorkspaceHistory } from '../src/ui/history/useWorkspaceHistory.ts';
import { useWorkspaceImport } from '../src/ui/workspace/useWorkspaceImport.ts';
import { useFileWorkflow } from '../src/ui/documents/useFileWorkflow.ts';
import { usePreviewWindows } from '../src/ui/preview/usePreviewWindows.ts';
import { useAiRun } from '../src/ui/ai/useAiRun.ts';
import { useProjectLifetime } from '../src/ui/workspace/useViewLifetime.ts';
import {
  useSelectionScope,
  useCreatedSelection,
} from '../src/ui/canvas/useSelectionActions.ts';

const scope = {
  root: 'a',
  saveScope: 'save-a',
  sessionId: 'a',
  epoch: 1,
  canvasId: 'default',
  home: false,
};
const document = {
  id: 'd',
  relativePath: 'docs/d.md',
  revision: 3,
  structureRevision: 2,
  x: 10,
  y: 20,
  width: 120,
  height: 240,
  collapsed: false,
};
const node = (x = 10, y = 20) => ({
  id: 'd',
  position: { x, y },
  data: { kind: 'document', document },
  measured: { width: 120, height: 240 },
});
const section = {
  id: 's',
  relativePath: 'sections/s.md',
  x: 100,
  y: 200,
  width: 500,
  height: 500,
  members: [],
};
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function mount(t, hook, ports = {}) {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const saved = new Map(
    [
      'window',
      'document',
      'requestAnimationFrame',
      'IS_REACT_ACT_ENVIRONMENT',
    ].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    requestAnimationFrame: (fn) => {
      fn();
      return 1;
    },
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  let value, root;
  function Fixture({ input }) {
    value = hook(useSelectionScope(input), ports);
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
  await render(scope);
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of saved)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
  });
  return {
    get value() {
      return value;
    },
    render,
  };
}

test('drag plans convert relative coordinates and preserve collapsed stored height and revisions', () => {
  const input = {
    ...node(12, 34),
    parentId: 'section:s',
    data: { document: { ...document, collapsed: true } },
    measured: { width: 130, height: 38 },
  };
  assert.deepEqual(documentDragLayout(input, [section]), {
    kind: 'document',
    objectId: 'd',
    relativePath: 'docs/d.md',
    revision: 3,
    structureRevision: 2,
    size: false,
    x: 112,
    y: 234,
    width: 130,
    height: 240,
  });
  assert.equal(input.position.x, 12);
});

test('membership uses the visible center, smallest containing section and path-compatible old membership', () => {
  const small = {
    ...section,
    id: 'small',
    x: 110,
    y: 210,
    width: 160,
    height: 80,
  };
  const moved = {
    ...node(120, 220),
    measured: { width: 120, height: 38 },
    data: { document: { ...document, collapsed: true } },
  };
  assert.equal(
    documentMembership(moved, [section, small]).toSection.id,
    'small',
  );
  const original = {
    ...section,
    members: [{ id: 'old-id', path: document.relativePath }],
  };
  const leaving = documentMembership(node(900, 900), [original]);
  assert.equal(leaving.fromSection.id, 's');
  assert.equal(leaving.toSection, null);
  assert.equal(documentMembership(node(900, 900), []), null);
});

test('mixed and drawing-only transfers preserve the single canvas transaction and expected generations', () => {
  const input = {
    source: 'a',
    paths: ['docs/d.md'],
    drawings: [{ id: 'drawing', generation: 'g' }],
  };
  const plan = canvasTransferPlan(input, 'b', 'raw');
  assert.deepEqual(
    plan.commands.map((c) => c.channel),
    ['canvases:change', 'drawings:apply'],
  );
  assert.equal(plan.command.expected, 'raw');
  assert.deepEqual(plan.commands[1].input.targets, [
    { id: 'drawing', generation: 'g' },
  ]);
  assert.deepEqual(
    canvasTransferPlan({ ...input, paths: [] }, 'b', null).commands.map(
      (c) => c.channel,
    ),
    ['drawings:apply'],
  );
  assert.deepEqual(input.paths, ['docs/d.md']);
});

test('created selection acknowledges actual nodes once and expires on an A → B → A visit', async (t) => {
  let ready = 0;
  const view = await mount(t, (input) => {
    const [nodes, setNodes] = React.useState([]);
    return {
      nodes,
      setNodes,
      select: useCreatedSelection(input, nodes, setNodes),
    };
  });
  await act(async () => view.value.select(['created'], () => ready++));
  assert.equal(ready, 0);
  await act(async () => view.value.setNodes([{ id: 'created' }]));
  assert.equal(ready, 1);
  assert.equal(view.value.nodes[0].selected, true);
  await act(async () => view.value.select(['later'], () => ready++));
  await view.render({ ...scope, canvasId: 'b' });
  await view.render(scope);
  await act(async () => view.value.setNodes([{ id: 'later' }]));
  assert.equal(ready, 1);
  assert.notEqual(view.value.nodes[0].selected, true);
});

function historyPorts(overrides = {}) {
  return {
    setHistoryOpen: () => {},
    setNavigatorOpen: () => {},
    setInspectorId: () => {},
    setSettingsOpen: () => {},
    setCodexRunCollapsed: () => {},
    showError: (error) => {
      throw error;
    },
    locked: false,
    onBlocked: () => {},
    blockAiFiles: () => false,
    editorsRef: { current: new Map() },
    loadProject: async () => {},
    setNotice: () => {},
    ...overrides,
  };
}
test('history ignores out-of-order file reads and a list response from an earlier visit', async (t) => {
  const list = deferred(),
    first = deferred(),
    second = deferred();
  const ports = historyPorts({
    api: {
      history: {
        listHistory: () => list.promise,
        readHistoryFile: (_id, path) =>
          path === 'first' ? first.promise : second.promise,
      },
    },
  });
  const view = await mount(t, (input) =>
    useWorkspaceHistory(input, () => ports),
  );
  let a, b;
  await act(async () => {
    view.value.openHistory();
    a = view.value.inspectHistory({ id: 'h' }, 'first', 'before');
    b = view.value.inspectHistory({ id: 'h' }, 'second', 'after');
  });
  await act(async () => {
    second.resolve('second');
    await b;
    first.resolve('first');
    await a;
  });
  assert.equal(view.value.historySelection.content, 'second');
  await view.render({ ...scope, canvasId: 'b' });
  await view.render(scope);
  await act(async () => {
    list.resolve([{ id: 'old' }]);
    await list.promise;
  });
  assert.deepEqual(view.value.historyEntries, []);
  assert.equal(view.value.historySelection, null);
});

test('history restore waits for captured editors and cancels before mutation after project switch', async (t) => {
  const flush = deferred();
  let restores = 0;
  const ports = historyPorts({
    editorsRef: { current: new Map([['editor', () => flush.promise]]) },
    api: { history: { restoreHistory: async () => restores++ } },
  });
  const view = await mount(t, (input) =>
    useWorkspaceHistory(input, () => ports),
  );
  await act(async () =>
    view.value.setHistoryConfirm({ entry: { id: 'h', files: [] } }),
  );
  let pending;
  await act(async () => {
    pending = view.value.restoreSelectedHistory();
  });
  await view.render({ ...scope, sessionId: 'new' });
  await act(async () => {
    flush.resolve();
    await pending;
  });
  assert.equal(restores, 0);
  assert.equal(view.value.restoring, false);
  assert.equal(view.value.historyConfirm, null);
});

test('history restore rejects a second click before React renders busy state', async (t) => {
  const gate = deferred();
  let restores = 0;
  const ports = historyPorts({
    api: {
      history: {
        restoreHistory: async () => {
          restores++;
          await gate.promise;
        },
        listHistory: async () => [],
      },
    },
  });
  const view = await mount(t, (input) =>
    useWorkspaceHistory(input, () => ports),
  );
  await act(async () =>
    view.value.setHistoryConfirm({ entry: { id: 'h', files: [] } }),
  );
  let pending;
  await act(async () => {
    const action = view.value.restoreSelectedHistory;
    pending = action();
    void action();
  });
  assert.equal(restores, 1);
  await act(async () => {
    gate.resolve();
    await pending;
  });
  assert.equal(view.value.restoring, false);
});

test('imports never acknowledge committed files into a later project view', async (t) => {
  const gate = deferred();
  let reloads = 0,
    selections = 0;
  const ports = {
    capabilities: { localFiles: true },
    setNotice: () => {},
    locked: false,
    onBlocked: () => {},
    workspace: { root: 'a' },
    openWorkspace: async () => {},
    flowRef: { current: null },
    api: { desktop: { importFiles: () => gate.promise } },
    activeCanvasRef: { current: 'default' },
    loadProject: async () => reloads++,
    showError: (error) => {
      throw error;
    },
    selectCreated: () => selections++,
  };
  const view = await mount(t, (input) =>
    useWorkspaceImport(input, () => ports),
  );
  await act(async () => view.value.openImport({ x: 10, y: 10 }));
  let pending;
  await act(async () => {
    pending = view.value.importFiles();
  });
  await view.render({ ...scope, root: 'b', sessionId: 'b' });
  await act(async () => {
    gate.resolve([{ id: 'created' }]);
    await pending;
  });
  assert.equal(reloads, 0);
  assert.equal(selections, 0);
  assert.equal(view.value.importTarget, null);
  assert.equal(view.value.importingFiles, false);
});

test('canvas switch checks its visit again after fetching sheets', async (t) => {
  const gate = deferred();
  let switches = 0;
  const ports = {
    activeCanvasRef: { current: 'default' },
    switchingCanvasRef: { current: false },
    flushEditors: async () => {},
    api: { editor: { getCanvasSheets: () => gate.promise } },
    setActiveCanvas: () => switches++,
  };
  const view = await mount(t, (input) =>
    useCanvasNavigation(input, () => ports),
  );
  let pending;
  await act(async () => {
    pending = view.value.switchCanvasTo('b');
  });
  await view.render({ ...scope, root: 'elsewhere', sessionId: 'elsewhere' });
  await act(async () => {
    gate.resolve({ canvases: [{ id: 'b' }] });
    await pending;
  });
  assert.equal(switches, 0);
  assert.equal(ports.activeCanvasRef.current, 'default');
  assert.equal(ports.switchingCanvasRef.current, false);
});

function geometryPorts(overrides = {}) {
  return {
    sections: [],
    api: { editor: { updateDocumentLayout: async () => {} } },
    loadProject: async () => {},
    showError: (error) => {
      throw error;
    },
    blockAiFiles: () => false,
    locked: false,
    setMembershipPrompt: () => {},
    ...overrides,
  };
}
test('an older drag completion cannot clear the pending position of a newer drag', async (t) => {
  const first = deferred(),
    second = deferred();
  const ports = geometryPorts({
    api: {
      editor: {
        updateDocumentLayout: (input) =>
          input.x === 10 ? first.promise : second.promise,
      },
    },
  });
  const view = await mount(t, (input) => useCanvasGeometry(input, () => ports));
  let a, b;
  await act(async () => {
    a = view.value.persistDraggedNodes(node(10), []);
    b = view.value.persistDraggedNodes(node(30), []);
  });
  await act(async () => {
    first.resolve();
    await a;
  });
  assert.equal(view.value.pendingGeometry.current.get('d').position.x, 30);
  await act(async () => {
    second.resolve();
    await b;
  });
  assert.equal(view.value.pendingGeometry.current.size, 0);
});

test('membership prompt opens after refresh completes, and only for the latest drag', async (t) => {
  const reload = deferred();
  const prompts = [];
  const ports = geometryPorts({
    sections: [section],
    loadProject: () => reload.promise,
    setMembershipPrompt: (prompt) => prompts.push(prompt),
  });
  const view = await mount(t, (input) => useCanvasGeometry(input, () => ports));
  let pending;
  await act(async () => {
    pending = view.value.persistDraggedNodes(node(120, 220), []);
  });
  assert.equal(prompts.length, 0);
  await act(async () => {
    reload.resolve();
    await pending;
  });
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].toSection.id, 's');
  assert.equal(view.value.pendingGeometry.current.size, 0);
});

test('canvas callback identities survive unrelated renders while commands read current ports', async (t) => {
  let writes = 0;
  const ports = {
    workflowEditable: false,
    api: { editor: { setFileStatusProperty: async () => writes++ } },
    loadProject: async () => {},
    showError: (error) => {
      throw error;
    },
  };
  const view = await mount(t, (input) => ({
    workflow: useFileWorkflow(input, () => ports),
    history: useWorkspaceHistory(input, () => historyPorts()),
    preview: usePreviewWindows(input, () => ({})),
  }));
  const initial = view.value;
  await view.render(scope);
  assert.equal(
    view.value.workflow.workflowChange,
    initial.workflow.workflowChange,
  );
  assert.equal(view.value.workflow.setWorkflow, initial.workflow.setWorkflow);
  assert.equal(
    view.value.preview.updatePreviewWindow,
    initial.preview.updatePreviewWindow,
  );
  assert.equal(view.value.history.openHistory, initial.history.openHistory);
  ports.workflowEditable = true;
  await act(async () =>
    view.value.workflow.workflowChange({ relativePath: 'docs/d.md' }),
  );
  assert.equal(writes, 1);
  await view.render({ ...scope, canvasId: 'elsewhere' });
  assert.notEqual(
    view.value.workflow.workflowChange,
    initial.workflow.workflowChange,
  );
});

test('AI preparation cannot launch a CLI in another session after editor flush', async (t) => {
  const flush = deferred();
  let starts = 0;
  const api = {
    ai: {
      getAiStatus: async () => ({ available: true, authenticated: true }),
      getActiveRun: async () => null,
      onCodexRunEvent: () => () => {},
      startCodexRun: async () => starts++,
    },
  };
  const runScopeRef = {
    current: { project: 'a', home: false, sessionId: 'a' },
  };
  const preferences = { getItem: () => null, setItem: () => {} };
  const view = await mount(t, (input) => {
    runScopeRef.current = {
      project: input.root,
      home: false,
      sessionId: input.sessionId,
    };
    return useAiRun(
      {
        noticeProject: input.root,
        home: false,
        workspace: {
          root: input.root,
          session: { sessionId: input.sessionId },
        },
        preferences,
        taskDocuments: [],
        aiResultPaths: [],
        collaboration: { active: false },
        capabilities: { localAiExecution: true },
        selectedAiProvider: 'codex-cli',
        selectedAiModel: '',
        selectedAiReasoning: null,
        runScopeRef,
        api,
        setApprovalInboxOpen: () => {},
        setInspectorId: () => {},
        setHistoryOpen: () => {},
        setSettingsOpen: () => {},
      },
      () => ({
        queueSupported: true,
        canRunAi: true,
        aiBusy: false,
        locked: false,
        onBlocked: () => {},
        editorsRef: { current: new Map([['editor', () => flush.promise]]) },
        setPreparingTask: () => {},
        showError: (error) => {
          throw error;
        },
        setNotice: () => {},
        loadProject: async () => {},
      }),
    );
  });
  let pending;
  await act(async () => {
    pending = view.value.runTaskWithCodex({
      relativePath: 'tasks/old.md',
      title: 'old',
    });
  });
  await view.render({ ...scope, sessionId: 'new' });
  await act(async () => {
    flush.resolve();
    await pending;
  });
  assert.equal(starts, 0);
});

test('AI connection preparation busy state and late completion belong to one project session', async (t) => {
  const connection = deferred();
  let block = false,
    starts = 0;
  const api = {
    ai: {
      getAiStatus: () =>
        block
          ? connection.promise
          : Promise.resolve({ available: true, authenticated: true }),
      getActiveRun: async () => null,
      onCodexRunEvent: () => () => {},
      startCodexRun: async () => starts++,
    },
  };
  const runScopeRef = {
    current: { project: 'a', home: false, sessionId: 'a' },
  };
  const view = await mount(t, (input) => {
    runScopeRef.current = {
      project: input.root,
      home: false,
      sessionId: input.sessionId,
    };
    return useAiRun(
      {
        noticeProject: input.root,
        home: false,
        workspace: {
          root: input.root,
          session: { sessionId: input.sessionId },
        },
        preferences: { getItem: () => null, setItem: () => {} },
        taskDocuments: [],
        aiResultPaths: [],
        collaboration: { active: false },
        capabilities: { localAiExecution: true },
        selectedAiProvider: 'codex-cli',
        selectedAiModel: '',
        selectedAiReasoning: null,
        runScopeRef,
        api,
        setApprovalInboxOpen: () => {},
        setInspectorId: () => {},
        setHistoryOpen: () => {},
        setSettingsOpen: () => {},
      },
      () => ({
        queueSupported: true,
        canRunAi: true,
        aiBusy: false,
        locked: false,
        onBlocked: () => {},
        editorsRef: { current: new Map() },
        showError: (error) => {
          throw error;
        },
        setNotice: () => {},
        loadProject: async () => {},
      }),
    );
  });
  block = true;
  let pending;
  await act(async () => {
    pending = view.value.runTaskWithCodex(
      { relativePath: 'tasks/old.md', title: 'old' },
      { id: 'approval' },
    );
  });
  assert.equal(view.value.preparingTask, true);
  block = false;
  await view.render({ ...scope, sessionId: 'new' });
  assert.equal(view.value.preparingTask, false);
  await act(async () => {
    connection.resolve({ available: true, authenticated: true });
    await pending;
  });
  assert.equal(starts, 0);
  assert.equal(view.value.preparingTask, false);
});

test('AI project lifetime keeps a captured canvas destination across tab changes and expires on session round trips', async (t) => {
  const view = await mount(t, (input) => ({
    current: useProjectLifetime(input),
  }));
  const original = view.value.current;
  await view.render({ ...scope, canvasId: 'another' });
  assert.equal(original(), true);
  await view.render({ ...scope, sessionId: 'another-session' });
  assert.equal(original(), false);
  await view.render(scope);
  assert.equal(original(), false);
  assert.equal(view.value.current(), true);
});
