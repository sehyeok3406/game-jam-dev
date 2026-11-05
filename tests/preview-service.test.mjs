import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProjectPreviewService } from '../src/application/editing/preview-service.ts';
import { FILE_NAMES_PATH } from '../src/contracts/document-names.ts';
import { htmlSourceId } from '../src/html-source.ts';
import { previewWindowPath } from '../src/preview-output.ts';

const state = { x: 10, y: 20, width: 800, height: 600, collapsed: false };
function setup(initial = {}) {
  const files = new Map(Object.entries(initial)),
    reads = [],
    writes = [],
    locks = [];
  const service = new ProjectPreviewService({
    project: {
      capture: async () => {
        throw Error('Window reads must not capture project assets');
      },
    },
    files: {
      read: async (p) => {
        reads.push(p);
        return files.get(p) ?? null;
      },
      replace: async (p, old, raw) => {
        assert.equal(files.get(p) ?? null, old);
        writes.push(p);
        files.set(p, raw);
      },
    },
    mutate: async (fn) => fn(),
    assertUnlocked: (paths) => locks.push(paths),
  });
  return { service, files, reads, writes, locks };
}

test('concurrent HTML window reads only read registry and window settings, never image snapshots', async () => {
  const f = setup();
  const paths = Array.from(
    { length: 50 },
    (_, i) => `output/inbox/game-${i}/v001/index.html`,
  );
  for (const p of paths)
    f.files.set(
      `.canvas/previews/${htmlSourceId(p)}.json`,
      JSON.stringify(state),
    );
  const values = await Promise.all(paths.map((p) => f.service.window(p)));
  assert.ok(values.every((v) => JSON.stringify(v) === JSON.stringify(state)));
  assert.equal(f.reads.length, 100);
  assert.equal(f.reads.filter((p) => p === FILE_NAMES_PATH).length, 50);
  assert.deepEqual(f.writes, []);
});

test('renamed HTML keeps stable ID window, original legacy fallback, and queued locked save', async () => {
  const original = 'output/inbox/game/v001/index.html',
    current = 'output/inbox/game/v001/새 게임.html';
  const id = 'stable-html';
  const f = setup({
    [FILE_NAMES_PATH]: JSON.stringify({
      version: 1,
      entries: [
        {
          id,
          kind: 'html',
          path: current,
          originalPath: original,
          previousPaths: [original],
          name: '새 게임',
        },
      ],
    }),
    [previewWindowPath(original)]: JSON.stringify(state),
  });
  assert.deepEqual(await f.service.window(current), state);
  const moved = { ...state, x: 123 };
  await f.service.saveWindow(moved, current);
  assert.deepEqual(f.locks, [[current, `.canvas/previews/${id}.json`]]);
  assert.deepEqual(f.writes, [`.canvas/previews/${id}.json`]);
  assert.deepEqual(await f.service.window(current), moved);
});

test('invalid paths, malformed registry and stale read failures are not converted into missing layouts', async () => {
  const f = setup();
  await assert.rejects(f.service.window('../outside.html'));
  assert.equal(f.reads.length, 0);
  f.files.set(FILE_NAMES_PATH, '{invalid');
  await assert.rejects(f.service.window('output/index.html'));
  assert.deepEqual(f.writes, []);
  const stale = new ProjectPreviewService({
    files: {
      read: async () => {
        throw Error('stale project');
      },
    },
  });
  await assert.rejects(stale.window('output/index.html'), /stale project/);
});
