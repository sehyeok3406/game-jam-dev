import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import {
  game,
  profile,
  boot,
  stop,
  wait,
  js,
  mouse,
  key,
} from './helpers/packaged-canvas.mjs';
await fs.writeFile(
  path.join(profile, 'test-user.json'),
  JSON.stringify({ nickname: '드래그 검증' }),
);
await fs.writeFile(
  path.join(game, 'project.md'),
  matter.stringify('# 프로젝트\n', {
    id: 'project',
    title: '프로젝트',
    type: 'system',
    x: 0,
    y: -400,
    width: 350,
    height: 300,
  }),
);
const count = 100;
const originals = new Map();
await fs.mkdir(path.join(game, 'ideas'), { recursive: true });
for (let i = 0; i < count; i++) {
  const raw = matter.stringify('## 본문 보존\n\n- 항목\n- **서식**\n', {
    id: 'drag-' + i,
    title: '이동 ' + i,
    type: 'idea',
    status: 'raw',
    x: (i % 12) * 380,
    y: Math.floor(i / 12) * 330,
    width: 350,
    height: 300,
    custom: { preserve: i },
  });
  originals.set('ideas/drag-' + i + '.md', raw);
  await fs.writeFile(path.join(game, 'ideas/drag-' + i + '.md'), raw);
}
const call = (method, ...args) =>
  js(
    `window.gameCanvas[${JSON.stringify(method)}](...${JSON.stringify(args)})`,
  );
const enter = async () => {
  await wait(
    `document.querySelectorAll('.react-flow__node-document').length >= ${count}`,
  );
};
try {
  await boot();
  await enter();
  const before = (await call('listDocuments'))
    .filter((d) => d.id.startsWith('drag-'))
    .sort((a, b) => a.id.localeCompare(b.id));
  const history = (await call('listHistory')).length;
  await key('a', 'KeyA', 65, 2);
  await wait(
    `document.querySelectorAll('.react-flow__node-document.selected').length >= ${count}`,
  );
  const point = await js(
    `(()=>{for(const el of document.querySelectorAll('.document-card__header')){const r=el.getBoundingClientRect();for(let x=Math.ceil(r.left)+5;x<r.right-5;x+=5){const y=Math.round(r.top+r.height/2),hit=document.elementFromPoint(x,y);if(y>140&&y<800&&x>130&&x<1100&&hit?.closest('.document-card__header')===el&&!hit.closest('button,.nodrag'))return {x,y};}}throw Error('No drag handle');})()`,
  );
  await js(
    "window.__notices=[];new MutationObserver(()=>{const t=document.querySelector('.status-toast')?.textContent;if(t&&window.__notices.at(-1)!==t)window.__notices.push(t)}).observe(document.body,{subtree:true,childList:true,characterData:true});",
  );
  await mouse('mousePressed', point.x, point.y);
  for (let i = 1; i <= 12; i++)
    await mouse('mouseMoved', point.x + i * 4, point.y + i);
  console.log(
    'During drag',
    await js(
      "({dragging:document.querySelectorAll('.react-flow__node.dragging').length,selected:document.querySelectorAll('.react-flow__node.selected').length,notice:document.querySelector('.status-toast')?.textContent})",
    ),
  );
  await new Promise((r) => setTimeout(r, 5200));
  assert.equal(
    (await call('listHistory')).length,
    history,
    'no history during long drag',
  );
  for (const [relative, raw] of originals)
    assert.equal(
      await fs.readFile(path.join(game, relative), 'utf8'),
      raw,
      'no file writes while dragging',
    );
  await mouse('mouseReleased', point.x + 48, point.y + 12);
  await wait(`!document.querySelector('.react-flow__node.dragging')`);
  for (let n = 0; n < 120; n++) {
    if ((await call('listHistory')).length > history) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log('Recorded notices', await js('window.__notices'));
  console.log(
    'First file',
    (await call('listDocuments')).find((d) => d.id === 'drag-0'),
  );
  console.log(
    'After drop',
    await js(
      "({notice:document.querySelector('.status-toast')?.textContent,alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent)})",
    ),
  );
  assert.equal((await call('listHistory')).length, history + 1);
  const moved = (await call('listDocuments'))
    .filter((d) => d.id.startsWith('drag-'))
    .sort((a, b) => a.id.localeCompare(b.id));
  const dx = moved[0].x - before[0].x,
    dy = moved[0].y - before[0].y;
  assert.ok(Math.abs(dx) + Math.abs(dy) > 1);
  for (let i = 0; i < count; i++) {
    assert.ok(Math.abs(moved[i].x - before[i].x - dx) < 0.01);
    assert.ok(Math.abs(moved[i].y - before[i].y - dy) < 0.01);
  }
  await call('undo');
  const undone = (await call('listDocuments'))
    .filter((d) => d.id.startsWith('drag-'))
    .sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(
    undone.map((d) => [d.x, d.y]),
    before.map((d) => [d.x, d.y]),
  );
  await call('redo');
  await stop(true);
  await boot();
  await enter();
  const restored = (await call('listDocuments'))
    .filter((d) => d.id.startsWith('drag-'))
    .sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(
    restored.map((d) => [d.x, d.y]),
    moved.map((d) => [d.x, d.y]),
  );
  for (const [relative, raw] of originals) {
    const current = matter(
        await fs.readFile(path.join(game, relative), 'utf8'),
      ),
      old = matter(raw);
    assert.equal(current.content, old.content);
    assert.deepEqual(current.data.custom, old.data.custom);
  }
  console.log(
    'PASS: 100-document pointer drag, no writes beyond 5s, one history batch, uniform movement, Undo/Redo, restart and Markdown/metadata preservation',
  );
} finally {
  await stop();
}
