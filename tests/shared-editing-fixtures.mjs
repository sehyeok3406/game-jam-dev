import matter from '../src/markdown.ts';
import { defaultStatuses } from '../src/document-statuses.ts';
import { defaultKanbanView } from '../src/features/kanban/view.ts';
import { RESULT_CATALOG_PATH } from '../src/result-structure.ts';
import { projectCopyBundle } from '../src/project-copy.ts';

export const environment = () => {
  let id = 0;
  return {
    now: () => 1234,
    id: () => `1000000${++id}-0000-4000-8000-000000000001`,
  };
};
export const docPath = 'ideas/a.md';
export const sectionPath = 'sections/group.md';
export const htmlPath = 'output/index.html';
export const html = '<!doctype html><html><body>original game</body></html>';
const note = (id, extra = {}) =>
  matter.stringify('한글 원문\n\n[자료](../docs/ref.md)', {
    id,
    title: id,
    type: 'idea',
    status: 'draft',
    sources: [],
    x: 10,
    y: 20,
    width: 340,
    height: 300,
    status_property_enabled: true,
    workflow_status_id: 'not-started',
    unknown_field: 'preserve',
    ...extra,
  });
export const initial = () => ({
  'project.md': note('project'),
  [docPath]: note('a'),
  'ideas/b.md': note('b'),
  [sectionPath]: note('group', {
    type: 'section',
    title: 'Group',
    x: 0,
    y: 0,
    width: 600,
    height: 400,
    members: [{ id: 'a', path: docPath }],
  }),
  [htmlPath]: html,
});
const layout = { relativePath: docPath, x: 50, y: 60, width: 350, height: 310 };
const workflow = {
  relativePath: docPath,
  objectId: 'a',
  expectedStatus: 'not-started',
  statusId: 'in-progress',
};
const drawing = {
  id: '00000000-0000-4000-8000-000000000001',
  generation: '00000000-0000-4000-8000-000000000002',
  kind: 'shape',
  geometry: { shape: 'rectangle' },
  transform: { x: 0, y: 0, width: 50, height: 50, rotation: 0 },
  style: {
    fill: '#ffffff',
    stroke: '#000000',
    strokeWidth: 2,
    opacity: 1,
    strokePattern: 'solid',
  },
  layer: 'annotation',
  order: 1,
  createdAt: 1234,
  updatedAt: 1234,
};
const frame = {
  version: 1,
  id: '00000000-0000-4000-8000-000000000003',
  generation: '00000000-0000-4000-8000-000000000004',
  canvasId: 'default',
  title: 'HUD',
  x: 0,
  y: 0,
  width: 720,
  viewportWidth: 1920,
  viewportHeight: 1080,
  items: [],
  descriptionPath: null,
};
const batchLayout = {
  commands: [
    {
      channel: 'layouts:update',
      input: { updates: [{ ...layout, kind: 'document' }] },
    },
  ],
};
const shape = { canvasId: 'default', action: 'create', objects: [drawing] };
const gameUi = {
  scope: 'local:test',
  action: 'create',
  id: frame.id,
  generation: frame.generation,
  frame,
};
const cases = [
  [
    'projects:import-copy',
    {
      requestId: '00000000-0000-4000-8000-000000000099',
      canvasId: 'default',
      bundle: projectCopyBundle(initial(), {
        canvasId: 'default',
        documents: [{ id: 'a', path: docPath }],
        sections: [],
        previews: [],
        drawings: [],
      }),
    },
    { requestId: 'invalid' },
  ],
  [
    'kanban:move-card',
    { ...workflow, expectedEnabled: true, expectedView: null },
    { ...workflow, expectedEnabled: true, expectedView: 'stale' },
  ],
  [
    'kanban:save-view',
    {
      expected: null,
      value: {
        ...defaultKanbanView(),
        backgrounds: { done: { mode: 'custom', color: '#123456' } },
      },
    },
    { expected: 'stale', value: defaultKanbanView() },
  ],
  [
    'files:set-status-property',
    { ...workflow, expectedEnabled: true },
    { ...workflow, expectedEnabled: false },
  ],
  ['documents:set-workflow', workflow, { ...workflow, expectedStatus: 'done' }],
  [
    'document-statuses:save',
    { expected: null, value: defaultStatuses() },
    { expected: 'stale', value: defaultStatuses() },
  ],
  ['drawings:apply', shape, { ...shape, objects: [drawing, drawing] }],
  ['game-ui:apply', gameUi, { ...gameUi, frame: { ...frame, width: -1 } }],
  [
    'canvas:batch',
    batchLayout,
    {
      commands: [
        ...batchLayout.commands,
        {
          channel: 'layouts:update',
          input: { updates: [{ ...layout, kind: 'invalid' }] },
        },
      ],
    },
  ],
  [
    'canvases:change',
    { action: 'add', id: 'second', name: 'Second', expected: null },
    { action: 'add', id: 'second', name: 'Second', expected: 'stale' },
  ],
  [
    'results:move',
    { relativePath: htmlPath, category: 'systems', feature: 'combat' },
    {
      relativePath: 'output/missing.html',
      category: 'systems',
      feature: 'combat',
    },
  ],
  [
    'results:organize',
    {},
    {},
    (files) => ({ ...files, [RESULT_CATALOG_PATH]: '{broken' }),
  ],
  [
    'documents:set-color',
    { relativePath: docPath, color: 'pink' },
    { relativePath: docPath, color: 'not-a-color' },
  ],
  [
    'files:import-batch',
    {
      x: 100,
      y: 100,
      imagePurpose: 'asset',
      files: [{ name: 'input.md', content: '# Imported\n\nKeep this text' }],
    },
    {
      x: 100,
      y: 100,
      imagePurpose: 'asset',
      files: [{ name: '../escape.md', content: 'unsafe' }],
    },
  ],
  [
    'documents:delete-many',
    { documents: [{ documentId: 'a', relativePath: docPath }] },
    {
      documents: [
        { documentId: 'a', relativePath: docPath },
        { documentId: 'missing', relativePath: 'ideas/missing.md' },
      ],
    },
  ],
  [
    'documents:create-idea',
    { x: 800, y: 800, width: 340, height: 300 },
    { x: 800, y: 800, width: -1, height: 300 },
  ],
  [
    'documents:save',
    {
      relativePath: docPath,
      documentId: 'a',
      title: '수정 제목',
      body: '한글 수정 본문',
    },
    { relativePath: '../outside.md', title: 'invalid', body: 'invalid' },
  ],
  [
    'documents:delete',
    { documentId: 'a', relativePath: docPath },
    { documentId: 'other-identity', relativePath: docPath },
  ],
  [
    'documents:duplicate',
    { documents: [{ id: 'a', path: docPath }], offsetX: 32, offsetY: 32 },
    {
      documents: [{ id: 'missing', path: 'ideas/missing.md' }],
      offsetX: 32,
      offsetY: 32,
    },
  ],
  [
    'sections:create',
    {
      title: 'New group',
      x: 0,
      y: 0,
      width: 600,
      height: 400,
      members: [{ id: 'b', path: 'ideas/b.md' }],
    },
    {
      title: 'New group',
      x: 0,
      y: 0,
      width: 600,
      height: 400,
      members: [
        { id: 'b', path: 'ideas/b.md' },
        { id: 'b', path: 'ideas/b.md' },
      ],
    },
  ],
  [
    'sections:rename',
    { relativePath: sectionPath, title: 'Changed group' },
    { relativePath: sectionPath, title: '   ' },
  ],
  [
    'sections:delete',
    { relativePath: sectionPath, sectionId: 'group', deleteMembers: false },
    { relativePath: sectionPath, sectionId: 'wrong', deleteMembers: false },
  ],
  [
    'sections:move-document',
    {
      documentId: 'b',
      documentPath: 'ideas/b.md',
      targetSectionId: 'group',
      x: 70,
      y: 80,
      width: 340,
      height: 300,
    },
    {
      documentId: 'b',
      documentPath: 'ideas/b.md',
      targetSectionId: 'missing',
      x: 70,
      y: 80,
      width: 340,
      height: 300,
    },
  ],
  ['documents:update-layout', layout, { ...layout, x: NaN }],
  [
    'sections:update-layout',
    { relativePath: sectionPath, x: 20, y: 30, width: 700, height: 500 },
    {
      relativePath: 'sections/missing.md',
      x: 20,
      y: 30,
      width: 700,
      height: 500,
    },
  ],
  [
    'layouts:update',
    { updates: [{ ...layout, kind: 'document' }] },
    {
      updates: [
        { ...layout, kind: 'document' },
        { ...layout, kind: 'invalid' },
      ],
    },
  ],
  [
    'tasks:create',
    {
      kind: 'implement',
      inputPaths: [docPath],
      htmlResult: { mode: 'new' },
      x: 1000,
      y: 1000,
    },
    {
      kind: 'implement',
      inputPaths: ['ideas/missing.md'],
      htmlResult: { mode: 'new' },
      x: 1000,
      y: 1000,
    },
  ],
];
export const commands = cases.map(
  ([channel, input, invalid, invalidBefore]) => ({
    channel,
    input,
    invalid,
    invalidBefore,
  }),
);
