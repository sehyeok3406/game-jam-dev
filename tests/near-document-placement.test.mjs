import test from 'node:test';
import assert from 'node:assert/strict';
import matter from '../src/markdown.ts';
import {
  nearDocumentPosition,
  mainDocumentCluster,
  rectDistance,
} from '../src/canvas-placement.ts';
import { changeCanvasSheets } from '../src/canvas-sheet-commands.ts';
import {
  describePreview,
  htmlSourcePath,
  sourceMetadata,
} from '../src/html-source.ts';
import { invertEdit } from '../src/edit-journal.ts';
import { readMiniMapPreferences } from '../src/ui/minimap-preferences.ts';
import { filePlacementRect } from '../src/canvas-move-placement.ts';
const cluster = [
  { x: 100, y: 100, width: 340, height: 300 },
  { x: 480, y: 100, width: 340, height: 300 },
];
test('placement uses the same minimum visible sizes as notes and sections', () => {
  const raw = matter.stringify('legacy', {
    id: 'legacy',
    canvas_id: 'target',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
  });
  assert.deepEqual(filePlacementRect('ideas/legacy.md', raw), {
    x: 0,
    y: 0,
    width: 260,
    height: 180,
  });
  assert.deepEqual(filePlacementRect('sections/legacy.md', raw), {
    x: 0,
    y: 0,
    width: 420,
    height: 280,
  });
});
test('placement stays adjacent to the main group even when origin and outlier are distant', () => {
  const outlier = { x: 30000, y: 40000, width: 340, height: 300 },
    rects = [...cluster, outlier];
  assert.deepEqual(mainDocumentCluster(rects, { x: 30000, y: 40000 }), cluster);
  const p = {
    ...nearDocumentPosition({ width: 960, height: 520 }, rects, {
      x: 50000,
      y: 50000,
    }),
    width: 960,
    height: 520,
  };
  assert.equal(Math.min(...cluster.map((r) => rectDistance(p, r))), 40);
  assert.ok(rects.every((r) => rectDistance(p, r) >= 40));
});
test('empty destination uses fallback coordinates and nearby holes remain collision free', () => {
  assert.deepEqual(
    nearDocumentPosition({ width: 340, height: 300 }, [], { x: 0, y: -500 }),
    { x: 0, y: -500 },
  );
  const rects = Array.from({ length: 30 }, (_, i) => ({
    x: (i % 6) * 380,
    y: Math.floor(i / 6) * 340,
    width: 340,
    height: 300,
  }));
  const p = {
    ...nearDocumentPosition({ width: 340, height: 300 }, rects),
    width: 340,
    height: 300,
  };
  assert.ok(rects.every((r) => rectDistance(p, r) >= 40));
  assert.equal(Math.min(...rects.map((r) => rectDistance(p, r))), 40);
});
const md = (id, canvas, x, y, extra = {}) =>
  matter.stringify(`${id} content`, {
    id,
    title: id,
    type: 'idea',
    canvas_id: canvas,
    x,
    y,
    width: 340,
    height: 300,
    ...extra,
  });
const registry = JSON.stringify({
  version: 1,
  canvases: [
    { id: 'default', name: 'source' },
    { id: 'target', name: 'target' },
  ],
});
const fixture = () => ({
  '.canvas/canvases.json': registry,
  'ideas/one.md': md('one', 'target', 100, 100),
  'ideas/two.md': md('two', 'target', 480, 100),
  'ideas/outlier.md': md('outlier', 'target', 30000, 40000),
  'ideas/moved.md': md('moved', 'default', -50000, 30000),
  'sections/empty.md': md('empty', 'target', -100000, -100000, {
    width: 200000,
    height: 200000,
    members: [],
  }),
});
const move = (files, paths) =>
  changeCanvasSheets(files, {
    action: 'move',
    id: 'default',
    targetId: 'target',
    paths,
    expected: registry,
  });
test('cross-canvas move translates coordinates beside destination documents and ignores empty sections', () => {
  const before = fixture(),
    after = move(before, ['ideas/moved.md']),
    d = matter(after['ideas/moved.md']);
  assert.equal(d.data.canvas_id, 'target');
  assert.equal(d.content, matter(before['ideas/moved.md']).content);
  assert.equal(Math.min(...cluster.map((r) => rectDistance(d.data, r))), 40);
  assert.equal(after['ideas/outlier.md'], before['ideas/outlier.md']);
  assert.deepEqual(invertEdit(after, before, after, 'undo'), before);
});
test('section and member offsets are retained by a single translated block', () => {
  const before = fixture();
  before['sections/group.md'] = md('group', 'default', 50000, 50000, {
    width: 900,
    height: 620,
    members: [{ id: 'moved', path: 'ideas/moved.md' }],
  });
  before['ideas/moved.md'] = md('moved', 'default', 50100, 50120);
  const after = move(before, ['sections/group.md']),
    s = matter(after['sections/group.md']).data,
    d = matter(after['ideas/moved.md']).data;
  assert.equal(d.x - s.x, 100);
  assert.equal(d.y - s.y, 120);
  assert.equal(s.canvas_id, 'target');
  assert.equal(d.canvas_id, 'target');
  assert.equal(Math.min(...cluster.map((r) => rectDistance(s, r))), 40);
});
test('HTML move creates a placement marker and removes its membership from an old section', () => {
  const before = fixture(),
    html = 'output/index.html',
    source = htmlSourcePath(html);
  before[html] = '<html><body>original HTML</body></html>';
  before[source] = sourceMetadata(html, before[html], { x: 50000, y: 50000 });
  before['sections/html.md'] = md('html-section', 'default', 50000, 50000, {
    members: [{ id: describePreview(before, html).sourceId, path: source }],
  });
  const after = move(before, [html]),
    p = describePreview(after, html);
  assert.equal(after[html], before[html]);
  assert.equal(p.canvasId, 'target');
  assert.ok(p.placementId);
  assert.equal(
    Math.min(...cluster.map((r) => rectDistance(p.initialWindow, r))),
    40,
  );
  assert.deepEqual(matter(after['sections/html.md']).data.members, []);
});
test('stored minimap settings reject malformed values and clamp transparency and shading', () => {
  assert.deepEqual(readMiniMapPreferences(null), {
    transparency: 0,
    shade: 18,
  });
  assert.deepEqual(
    readMiniMapPreferences({ transparency: Infinity, shade: '90' }),
    { transparency: 0, shade: 18 },
  );
  assert.deepEqual(readMiniMapPreferences({ transparency: 200, shade: -10 }), {
    transparency: 90,
    shade: 0,
  });
});
