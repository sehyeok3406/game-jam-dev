import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  root,
  profile,
  game,
  boot,
  stop,
  wait,
  js,
  send,
  mouse,
  key,
  pause,
} from './helpers/packaged-canvas.mjs';

const md = (id, x, width, height, extra = '') =>
  `---\nid: ${id}\ntitle: ${id}\ntype: idea\nstatus: draft\nx: ${x}\ny: 100\nwidth: ${width}\nheight: ${height}\n${extra}---\n# ${id}\n다중 크기 조절\n`;
await fs.mkdir(path.join(game, 'ideas'), { recursive: true });
await fs.writeFile(path.join(game, 'project.md'), md('resize-a', 80, 400, 300));
await fs.writeFile(
  path.join(game, 'ideas/b.md'),
  md('resize-b', 550, 300, 240),
);
await fs.writeFile(
  path.join(game, 'ideas/c.md'),
  md('resize-c', 950, 280, 220),
);
await fs.mkdir(path.join(game, 'output'), { recursive: true });
await fs.writeFile(
  path.join(game, 'output/index.html'),
  '<!doctype html><title>Resize HTML</title><body>HTML</body>',
);
await fs.mkdir(path.join(game, '.canvas'), { recursive: true });
await fs.writeFile(
  path.join(game, '.canvas/preview.json'),
  JSON.stringify({ x: 80, y: 500, width: 720, height: 340, collapsed: false }),
);
await fs.mkdir(path.join(game, 'output/versions'), { recursive: true });
await fs.mkdir(path.join(game, '.canvas/previews'), { recursive: true });
await fs.writeFile(
  path.join(game, 'output/versions/v2.html'),
  '<!doctype html><title>Second HTML</title><body>HTML 2</body>',
);
await fs.writeFile(
  path.join(game, '.canvas/previews/v2.json'),
  JSON.stringify({ x: 850, y: 500, width: 500, height: 340, collapsed: false }),
);
const node = (id) => `.react-flow__node[data-id="${id}"]`;
const geometry = () =>
  js(
    `Object.fromEntries([...document.querySelectorAll('.react-flow__node-document,.react-flow__node-preview')].map(n=>{const r=n.getBoundingClientRect();return[n.dataset.id,{x:r.x,y:r.y,width:r.width,height:r.height}]}))`,
  );
const fit = async () => {
  await js(
    `document.querySelector('button[title^="캔버스 전체 보기"]').click()`,
  );
  for (let i = 0; i < 5; i++) await pause();
};
const select = async (ids) => {
  await key('Escape', 'Escape', 27);
  for (let i = 0; i < ids.length; i++) {
    // Native Shift+click on the header exercises the same selection as the UI.
    const point = await js(
      `(()=>{const n=document.querySelector(${JSON.stringify(node(ids[i]))});const dot=n.querySelector('.preview-dot');const r=(dot??n.querySelector('header')).getBoundingClientRect();return{x:dot?r.x+r.width/2:r.left+Math.min(50,r.width/3),y:r.top+r.height/2}})()`,
    );
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...point,
      button: 'left',
      buttons: 1,
      clickCount: 1,
      modifiers: i ? 8 : 0,
    });
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...point,
      button: 'left',
      buttons: 0,
      clickCount: 1,
      modifiers: i ? 8 : 0,
    });
    await pause();
  }
  await wait(
    `document.querySelectorAll('.react-flow__node.selected').length===${ids.length}`,
  );
};
const resize = async (id, direction, dx, dy) => {
  const p = await js(
    `(()=>{const r=document.querySelector(${JSON.stringify(node(id))}+' .react-flow__resize-control.handle.${direction.split('-').join('.')}').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
  );
  assert.ok(
    (await js(`document.elementFromPoint(${p.x},${p.y})?.className`)).includes(
      'resize-control',
    ),
    'native pointer reaches resize control',
  );
  await mouse('mousePressed', p.x, p.y);
  for (let i = 1; i <= 5; i++)
    await mouse('mouseMoved', p.x + (dx * i) / 5, p.y + (dy * i) / 5);
  // Assert live geometry before releasing as well as after the save.
  const live = await geometry();
  await mouse('mouseReleased', p.x + dx, p.y + dy);
  for (let i = 0; i < 8; i++) await pause();
  return live;
};
const near = (a, b, message) =>
  assert.ok(Math.abs(a - b) < 2, `${message}: ${a} vs ${b}`);
const equalDelta = (before, after, ids) => {
  for (const axis of ['width', 'height']) {
    const delta = after[ids[0]][axis] - before[ids[0]][axis];
    for (const id of ids)
      near(
        after[id][axis] - before[id][axis],
        delta,
        `${id} same ${axis} delta`,
      );
  }
};
async function disk() {
  return js(
    `(async()=>({docs:(await window.gameCanvas.listDocuments()).map(d=>({id:d.id,x:d.x,y:d.y,width:d.width,height:d.height})),html:await window.gameCanvas.getPreviewWindow('output/index.html'),html2:await window.gameCanvas.getPreviewWindow('output/versions/v2.html')}))()`,
  );
}
const capture = async (name) => {
  await fs.mkdir('out/group-resize-packaged', { recursive: true });
  const shot = await send('Page.captureScreenshot');
  await fs.writeFile(
    `out/group-resize-packaged/${name}.png`,
    Buffer.from(shot.data, 'base64'),
  );
};
try {
  await boot();
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1500,
    height: 1050,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await wait(
    'document.querySelectorAll(".react-flow__node-document").length===3',
  );
  await fit();
  // Marquee selects just the first two documents.
  const a = await geometry();
  const p = { x: a['resize-a'].x - 10, y: a['resize-a'].y - 10 };
  const q = {
    x: a['resize-b'].x + a['resize-b'].width + 10,
    y: a['resize-a'].y + a['resize-a'].height + 10,
  };
  await mouse('mousePressed', p.x, p.y);
  for (let i = 1; i <= 8; i++)
    await mouse(
      'mouseMoved',
      p.x + ((q.x - p.x) * i) / 8,
      p.y + ((q.y - p.y) * i) / 8,
    );
  await mouse('mouseReleased', q.x, q.y);
  await wait(
    'document.querySelectorAll(".react-flow__node-document.selected").length===2',
  );
  const groupBefore = await geometry();
  const gap = {
    x:
      (groupBefore['resize-a'].x +
        groupBefore['resize-a'].width +
        groupBefore['resize-b'].x) /
      2,
    y: groupBefore['resize-b'].y + 45,
  };
  assert.ok(
    (
      await js(`document.elementFromPoint(${gap.x},${gap.y})?.className`)
    ).includes('nodesselection-rect'),
    'group rectangle remains draggable between cards',
  );
  await mouse('mousePressed', gap.x, gap.y);
  for (let i = 1; i <= 5; i++)
    await mouse('mouseMoved', gap.x + (15 * i) / 5, gap.y + (10 * i) / 5);
  await mouse('mouseReleased', gap.x + 15, gap.y + 10);
  for (let i = 0; i < 6; i++) await pause();
  const groupAfter = await geometry();
  near(
    groupAfter['resize-a'].x - groupBefore['resize-a'].x,
    groupAfter['resize-b'].x - groupBefore['resize-b'].x,
    'group movement preserved',
  );
  assert.ok(groupAfter['resize-a'].x > groupBefore['resize-a'].x + 8);
  let before = await geometry();
  const live = await resize('resize-a', 'bottom-right', 40, 30);
  let after = await geometry();
  equalDelta(before, live, ['resize-a', 'resize-b']);
  equalDelta(before, after, ['resize-a', 'resize-b']);
  assert.ok(after['resize-a'].width > before['resize-a'].width + 20);
  near(
    after['resize-c'].width,
    before['resize-c'].width,
    'unselected document unchanged',
  );
  let saved = await disk();
  const firstSaved = saved.docs;
  const dA = saved.docs.find((d) => d.id === 'resize-a'),
    dB = saved.docs.find((d) => d.id === 'resize-b');
  near(dA.width - 400, dB.width - 300, 'saved widths have equal delta');
  near(dA.height - 300, dB.height - 240, 'saved heights have equal delta');
  await key('z', 'KeyZ', 90, 2);
  await wait(
    `window.gameCanvas.listDocuments().then(d=>d.find(x=>x.id==='resize-a').width===400&&d.find(x=>x.id==='resize-b').width===300)`,
  );
  await key('z', 'KeyZ', 90, 10);
  await wait(
    `window.gameCanvas.listDocuments().then(d=>Math.abs(d.find(x=>x.id==='resize-a').width-${dA.width})<1)`,
  );
  // Mixed Shift selection, with HTML as the dragged primary.
  await select(['resize-a', 'preview:output/index.html']);
  before = await geometry();
  await resize('preview:output/index.html', 'top-left', -35, -20);
  after = await geometry();
  equalDelta(before, after, ['resize-a', 'preview:output/index.html']);
  for (const id of ['resize-a', 'preview:output/index.html']) {
    near(
      before[id].x + before[id].width,
      after[id].x + after[id].width,
      'opposite horizontal edge fixed',
    );
    near(
      before[id].y + before[id].height,
      after[id].y + after[id].height,
      'opposite vertical edge fixed',
    );
  }
  // A pointer jump shrinks both exactly to the most restrictive minimum.
  await select(['resize-b', 'preview:output/index.html']);
  before = await geometry();
  await resize('preview:output/index.html', 'top-right', -220, 180);
  after = await geometry();
  equalDelta(before, after, ['resize-b', 'preview:output/index.html']);
  saved = await disk();
  const minDoc = saved.docs.find((d) => d.id === 'resize-b');
  near(minDoc.width, 260, 'document minimum width');
  assert.ok(minDoc.height >= 180 && saved.html.height >= 300);
  // Single selection continues to resize only the chosen card.
  await select(['resize-c']);
  before = await geometry();
  await resize('resize-c', 'bottom-right', 25, 20);
  after = await geometry();
  near(
    after['resize-a'].width,
    before['resize-a'].width,
    'single selection does not resize others',
  );
  assert.ok(after['resize-c'].width > before['resize-c'].width + 10);
  // HTML-only resizing at a different zoom, including a horizontal edge.
  await select([
    'preview:output/index.html',
    'preview:output/versions/v2.html',
  ]);
  await js(`document.querySelector('button[aria-label="축소"]').click()`);
  for (let i = 0; i < 4; i++) await pause();
  before = await geometry();
  const p2 = await js(
    `(()=>{const r=document.querySelector(${JSON.stringify(node('preview:output/versions/v2.html'))}+' .react-flow__resize-control.line.right').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+20}})()`,
  );
  await mouse('mousePressed', p2.x, p2.y);
  await mouse('mouseMoved', p2.x + 30, p2.y);
  await mouse('mouseReleased', p2.x + 30, p2.y);
  for (let i = 0; i < 8; i++) await pause();
  after = await geometry();
  equalDelta(before, after, [
    'preview:output/index.html',
    'preview:output/versions/v2.html',
  ]);
  assert.ok(
    after['preview:output/index.html'].width >
      before['preview:output/index.html'].width + 15,
  );
  near(
    after['preview:output/index.html'].height,
    before['preview:output/index.html'].height,
    'horizontal handle preserves height',
  );
  assert.equal(
    await js('document.querySelector("[data-canvas-resizing]")===null'),
    true,
    'iframe input shield released',
  );
  const excludedBefore = await disk();
  await js(
    `(async()=>{await window.gameCanvas.setDocumentCollapsed({relativePath:'ideas/c.md',collapsed:true});const s=await window.gameCanvas.getPreviewWindow('output/versions/v2.html');await window.gameCanvas.savePreviewWindow({...s,presetId:'mobile-320'},'output/versions/v2.html')})()`,
  );
  await stop(true);
  await boot();
  await fit();
  await wait(
    `!document.querySelector(${JSON.stringify(node('resize-c'))}+' .react-flow__resize-control')&&!document.querySelector(${JSON.stringify(node('preview:output/versions/v2.html'))}+' .react-flow__resize-control')`,
  );
  const all = Object.values(await geometry());
  const start = {
    x: Math.min(...all.map((r) => r.x)) - 12,
    y: Math.min(...all.map((r) => r.y)) - 12,
  };
  const end = {
    x: Math.max(...all.map((r) => r.x + r.width)) + 12,
    y: Math.max(...all.map((r) => r.y + r.height)) + 12,
  };
  await mouse('mousePressed', start.x, start.y);
  for (let i = 1; i <= 8; i++)
    await mouse('mouseMoved', start.x + ((end.x - start.x) * i) / 8, start.y);
  for (let i = 1; i <= 8; i++)
    await mouse('mouseMoved', end.x, start.y + ((end.y - start.y) * i) / 8);
  await mouse('mouseReleased', end.x, end.y);
  await wait(
    'document.querySelectorAll(".react-flow__node.selected").length===5',
  );
  const excluded = await disk();
  await resize('resize-a', 'top-right', 20, -10);
  const excludedAfter = await disk();
  assert.deepEqual(
    excludedAfter.docs.find((d) => d.id === 'resize-c'),
    excludedBefore.docs.find((d) => d.id === 'resize-c'),
    'collapsed document excluded',
  );
  assert.deepEqual(
    excludedAfter.html2,
    excluded.html2,
    'fixed resolution HTML excluded',
  );
  const finalDisk = await disk();
  await capture('complete');
  await stop(true);
  await boot();
  await wait(
    `window.gameCanvas.listDocuments().then(d=>Math.abs(d.find(x=>x.id==='resize-c').width-${finalDisk.docs.find((d) => d.id === 'resize-c').width})<1)`,
  );
  const reopened = await disk();
  assert.deepEqual(reopened, finalDisk);
  await fs.writeFile(
    'out/group-resize-packaged/result.json',
    JSON.stringify({ firstSaved, finalDisk, reopened, passed: true }, null, 2),
  );
  console.log(
    'PASS: packaged marquee/Shift mixed resizing, equal live/saved deltas, minimum bounds, opposite anchors, document batch undo/redo, single resize and full restart persistence.',
  );
} catch (error) {
  if (js) await capture('failure').catch(() => {});
  throw error;
} finally {
  await stop();
  assert.ok(
    path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep),
  );
  assert.ok(
    path
      .resolve(profile)
      .startsWith(
        path.resolve(process.env.APPDATA, 'Game Canvas', 'test-users') +
          path.sep,
      ),
  );
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(profile, { recursive: true, force: true });
}
