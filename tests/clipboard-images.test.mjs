import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  readCanvasClipboard,
  assertClipboardDimensions,
  ClipboardRequestCache,
  CANVAS_CLIPBOARD_MIME,
} from '../src/clipboard-images.ts';
import { invertEdit } from '../src/edit-journal.ts';
import { buildFileImports, encodeAsset } from '../src/file-assets.ts';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGL538AAAAAA///5tjreAAAABklEQVQDAAQRAYTXKkMGAAAAAElFTkSuQmCC',
  'base64',
);
const item = (data) => ({
  types: Object.keys(data),
  getType: async (mime) => new Blob([data[mime]]),
});

test('clipboard chooses a single preferred MIME, ignores HTML, and generates safe names', async () => {
  const result = await readCanvasClipboard([
    item({
      'image/jpeg': 'invalid alternate',
      'text/html': '<img src="https://example.test/image">',
      'image/png': png,
    }),
  ]);
  assert.equal(result.kind, 'images');
  assert.equal(result.files.length, 1);
  assert.match(result.files[0].name, /^clipboard-[\da-f-]{36}\.png$/);
  const additions = buildFileImports({
    x: 0,
    y: 0,
    imagePurpose: 'asset',
    files: result.files,
  });
  assert.ok(
    Object.values(additions).some((text) =>
      text.includes('title: 붙여넣은 이미지'),
    ),
  );
});

test('registered internal token wins; stale, malformed and oversized tokens cannot fall back', async () => {
  const copyId = randomUUID();
  const token = item({
    [CANVAS_CLIPBOARD_MIME]: JSON.stringify({ version: 1, copyId }),
    'image/png': png,
  });
  assert.deepEqual(await readCanvasClipboard([token], copyId), {
    kind: 'internal',
    copyId,
  });
  assert.deepEqual(await readCanvasClipboard([token], randomUUID()), {
    kind: 'stale-internal',
  });
  assert.deepEqual(
    await readCanvasClipboard([item({ [CANVAS_CLIPBOARD_MIME]: 'not json' })]),
    { kind: 'stale-internal' },
  );
  assert.deepEqual(
    await readCanvasClipboard([
      item({ [CANVAS_CLIPBOARD_MIME]: 'x'.repeat(201) }),
    ]),
    { kind: 'stale-internal' },
  );
  assert.deepEqual(
    await readCanvasClipboard(
      [item({ 'text/plain': 'text copied after cards' })],
      copyId,
    ),
    { kind: 'empty' },
  );
  assert.deepEqual(
    await readCanvasClipboard([item({ 'image/svg+xml': '<svg/>' })]),
    { kind: 'unsupported' },
  );
});

test('validation rejects malformed preferred format, per-image/count/aggregate overflow, and partial batches', async () => {
  await assert.rejects(
    readCanvasClipboard([
      item({ 'image/png': 'broken', 'image/gif': 'GIF87a' }),
    ]),
  );
  await assert.rejects(
    readCanvasClipboard([item({ 'image/png': Buffer.alloc(5_000_001) })]),
    /5MB/,
  );
  await assert.rejects(
    readCanvasClipboard(
      Array.from({ length: 21 }, () => item({ 'image/png': png })),
    ),
    /20개/,
  );
  await assert.rejects(
    readCanvasClipboard(
      Array.from({ length: 3 }, () =>
        item({ 'image/png': Buffer.alloc(4_000_001) }),
      ),
    ),
    /12MB/,
  );
  await assert.rejects(
    readCanvasClipboard([
      item({ 'image/png': png }),
      item({ 'image/png': 'invalid' }),
    ]),
  );
  const limit = Buffer.alloc(5_000_000);
  png.copy(limit);
  assert.equal(
    (await readCanvasClipboard([item({ 'image/png': limit })])).kind,
    'images',
  );
  assert.equal(
    (
      await readCanvasClipboard(
        Array.from({ length: 20 }, () => item({ 'image/png': png })),
      )
    ).files.length,
    20,
  );
});

test('PNG/JPEG dimensions are checked before native decoding, including segment bounds', () => {
  const large = Buffer.from(png);
  large.writeUInt32BE(8000, 16);
  large.writeUInt32BE(4001, 20);
  assert.throws(() => assertClipboardDimensions(large, 'png'), /픽셀/);
  large.writeUInt32BE(4000, 20);
  assert.doesNotThrow(() => assertClipboardDimensions(large, 'png'));
  const jpeg = Buffer.from([
    255, 216, 255, 224, 0, 2, 255, 192, 0, 8, 8, 0, 8, 0, 8, 1, 255, 217,
  ]);
  assert.doesNotThrow(() => assertClipboardDimensions(jpeg, 'jpg'));
  jpeg.writeUInt16BE(65535, 11);
  jpeg.writeUInt16BE(65535, 13);
  assert.throws(() => assertClipboardDimensions(jpeg, 'jpg'));
  jpeg.writeUInt16BE(65535, 8);
  assert.throws(() => assertClipboardDimensions(jpeg, 'jpg'));
});

test('request cache shares pending/results/errors and permits distinct paste IDs', async () => {
  const cache = new ClipboardRequestCache();
  let calls = 0,
    release;
  const work = () => {
    calls++;
    return new Promise((r) => {
      release = r;
    });
  };
  const first = cache.run('one', work),
    second = cache.run('one', work);
  await Promise.resolve();
  assert.equal(calls, 1);
  release({ saved: true });
  assert.deepEqual(await first, await second);
  await cache.run('one', work);
  assert.equal(calls, 1);
  await assert.rejects(
    cache.run('error', async () => {
      calls++;
      throw Error('uncertain commit');
    }),
  );
  await assert.rejects(cache.run('error', work));
  assert.equal(calls, 2);
  await cache.run('two', async () => {
    calls++;
  });
  assert.equal(calls, 3);
  cache.clear();
  await cache.run('one', async () => {
    calls++;
  });
  assert.equal(calls, 4);
});

test('undo rejects deletion of images referenced by surviving Markdown and reference definitions', () => {
  const asset = 'assets/images/example.png',
    image = encodeAsset(asset, png);
  const after = { [asset]: image, 'docs/imported/image.md': 'image card' };
  for (const body of [
    '![image](../assets/images/example.png)',
    '![image][art]\n\n[art]: ../assets/images/example.png',
  ]) {
    assert.throws(
      () =>
        invertEdit({ ...after, 'docs/reference.md': body }, {}, after, 'undo'),
      /참조/,
    );
  }
  const unrelated = {
    ...after,
    'docs/reference.md': '`![not an image](../assets/images/example.png)`',
  };
  const undone = invertEdit(unrelated, {}, after, 'undo');
  assert.equal(undone[asset], undefined);
  assert.equal(undone['docs/reference.md'], unrelated['docs/reference.md']);
});
