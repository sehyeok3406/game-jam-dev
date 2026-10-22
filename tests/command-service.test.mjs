import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { LocalCommandService } from '../src/application/editing/command-service.ts';
import { LocalCanvasService } from '../src/application/editing/canvas-service.ts';
import { reduceCollaboration } from '../src/collaboration-model.ts';

const environment = {
  now: () => 1234,
  id: () => '00000000-0000-4000-8000-000000000001',
};
const html = '<!doctype html><html><body>preserve large preview</body></html>';
function repository(initial = {}) {
  let files = initial;
  let failure = false;
  const writes = [];
  return {
    capture: async () => ({ ...files }),
    history: async () => [],
    recover: async () => {},
    apply: async (before, changes) => {
      if (failure) {
        failure = false;
        throw Error('disk failure');
      }
      for (const key of Object.keys(changes))
        assert.equal(files[key], before[key], 'external edit check');
      writes.push(changes);
      files = { ...files };
      for (const [key, raw] of Object.entries(changes)) {
        if (raw === null) delete files[key];
        else files[key] = raw;
      }
    },
    get files() {
      return files;
    },
    writes,
    fail() {
      failure = true;
    },
  };
}
const signature = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('local and shared create/batch plans use the same fixed IDs/time and publish only changed files', async () => {
  const repo = repository({ 'output/index.html': html });
  const local = new LocalCommandService(repo, environment);
  const input = { x: 10, y: 20 };
  const shared = reduceCollaboration(
    repo.files,
    'documents:create-idea',
    input,
    environment,
  );
  const created = await local.execute('documents:create-idea', input);
  assert.deepEqual(repo.files, shared.files);
  assert.deepEqual(created, shared.result);
  assert.equal(created.modifiedAt, 1234);
  assert.equal(
    repo.writes[0]['output/index.html'],
    undefined,
    'HTML is never retransmitted by an unrelated edit',
  );
  const batch = {
    commands: [
      {
        channel: 'documents:duplicate',
        input: {
          offsetX: 32,
          offsetY: 32,
          documents: [{ id: created.id, path: created.relativePath }],
        },
      },
    ],
  };
  const expected = reduceCollaboration(
    repo.files,
    'canvas:batch',
    batch,
    environment,
  );
  assert.deepEqual(await local.execute('canvas:batch', batch), expected.result);
  assert.deepEqual(repo.files, expected.files);
  assert.ok(
    Object.values(repo.writes[1]).every((raw) =>
      raw.includes('updated_at: 1234'),
    ),
  );
  const before = { ...repo.files };
  await assert.rejects(
    local.execute('canvas:batch', {
      commands: [
        {
          channel: 'documents:delete-many',
          input: {
            documents: [
              { documentId: created.id, relativePath: created.relativePath },
            ],
          },
        },
        {
          channel: 'canvases:change',
          input: {
            action: 'rename',
            id: 'missing',
            name: 'invalid',
            expected: null,
          },
        },
      ],
    }),
  );
  assert.deepEqual(repo.files, before);
  assert.equal(
    repo.writes.length,
    2,
    'an invalid compound command publishes nothing',
  );
});

test('failed canvas storage is retryable and acknowledged canvas requests are applied once', async () => {
  const repo = repository();
  const canvas = new LocalCanvasService(() => repo, signature);
  const frame = {
    version: 1,
    id: randomUUID(),
    generation: randomUUID(),
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
  const command = {
    scope: 'local:test',
    requestId: randomUUID(),
    id: frame.id,
    generation: frame.generation,
    action: 'create',
    frame,
  };
  repo.fail();
  await assert.rejects(canvas.applyGameUi(command), /disk failure/);
  assert.deepEqual(repo.files, {});
  const created = await canvas.applyGameUi(command);
  assert.equal(created[0].id, frame.id);
  assert.deepEqual(await canvas.applyGameUi(command), created);
  assert.equal(repo.writes.length, 1);
  assert.deepEqual(await canvas.drawingDelta({ 'deleted-object': 'old' }), {
    changed: [],
    removed: ['deleted-object'],
    signatures: {},
  });
});
