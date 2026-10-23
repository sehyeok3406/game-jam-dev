import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from '../src/markdown.ts';
import { captureProject } from '../src/project-store.ts';
import { snapshotDocuments } from '../src/collaboration-model.ts';
import { decodeAsset } from '../src/file-assets.ts';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWRkAAAAASUVORK5CYII=',
  'base64',
);
export async function projectCopySetup({ root, profile, game }) {
  const target = path.join(root, 'target');
  await fs.mkdir(target);
  await fs.writeFile(
    path.join(target, 'project.md'),
    '---\nid: project\ntitle: target\n---\n대상 원문\n',
  );
  await fs.writeFile(
    path.join(profile, 'local-projects.json'),
    JSON.stringify([
      {
        id: 'local:' + game.toLowerCase(),
        root: game,
        name: '원본 프로젝트',
        kind: 'local',
        lastOpenedAt: Date.now() + 1000,
      },
      {
        id: 'local:' + target.toLowerCase(),
        root: target,
        name: '복사 대상',
        kind: 'local',
        lastOpenedAt: 0,
      },
    ]),
  );
  for (const [index, name] of ['project', 'a', 'b', 'c'].entries()) {
    const relative = name === 'project' ? 'project.md' : `docs/${name}.md`;
    await fs.writeFile(
      path.join(game, relative),
      matter.stringify(
        name === 'a'
          ? '![이미지](assets/images/source.png)\n\n[동료 문서](gamejam://document/b)\n'
          : `${name} 한글 원문\n`,
        {
          id: name,
          title: name,
          type: 'idea',
          x: index * 400,
          y: 0,
          width: 340,
          height: 300,
        },
      ),
    );
  }
  await fs.mkdir(path.join(game, 'assets/images'), { recursive: true });
  await fs.writeFile(path.join(game, 'assets/images/source.png'), png);
  await fs.rm(path.join(game, 'output/index.html'));
}

export async function projectCopyUiScenarios({
  js,
  send,
  call,
  wait,
  key,
  game,
  root,
}) {
  const selected = () =>
    js(
      `Array.from(document.querySelectorAll('.react-flow__node.selected')).map(n=>n.dataset.id).sort()`,
    );
  const point = (id) =>
    js(
      `(()=>{const r=document.querySelector('.react-flow__node[data-id="${id}"] .document-card__header').getBoundingClientRect();return {x:r.left+Math.min(30,r.width/3),y:r.top+r.height/2};})()`,
    );
  const click = async (p, button = 'left', modifiers = 0) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p });
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...p,
      button,
      buttons: button === 'right' ? 2 : 1,
      clickCount: 1,
      modifiers,
    });
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...p,
      button,
      buttons: 0,
      clickCount: 1,
      modifiers,
    });
  };
  await wait(
    'document.querySelectorAll(".react-flow__node-document").length===4',
  );
  await wait(
    `(()=>{const r=document.querySelector('.react-flow__node[data-id="a"] .document-card__header').getBoundingClientRect();return r.width>20 && document.elementFromPoint(r.left+Math.min(30,r.width/3),r.top+r.height/2)?.closest('.react-flow__node')?.dataset.id==='a';})()`,
  );
  await click(await point('a'));
  await wait(
    `document.querySelector('.react-flow__node[data-id="a"]').classList.contains('selected')`,
  );
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Shift',
    code: 'ShiftLeft',
    windowsVirtualKeyCode: 16,
    modifiers: 8,
  });
  await click(await point('b'), 'left', 8);
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Shift',
    code: 'ShiftLeft',
    windowsVirtualKeyCode: 16,
    modifiers: 0,
  });
  await wait(
    `document.querySelectorAll('.react-flow__node.selected').length===2`,
  );
  assert.deepEqual(await selected(), ['a', 'b']);
  await key('Escape');
  await wait(
    `document.querySelectorAll('.react-flow__node.selected').length===0`,
  );
  const bounds = await js(
    `(()=>{const a=document.querySelector('.react-flow__node[data-id="a"]').getBoundingClientRect(),b=document.querySelector('.react-flow__node[data-id="b"]').getBoundingClientRect();return {start:{x:Math.min(a.left,b.left)-10,y:Math.min(a.top,b.top)-10},end:{x:Math.max(a.right,b.right)+10,y:Math.max(a.bottom,b.bottom)+10}};})()`,
  );
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    ...bounds.start,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...bounds.start,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  for (let step = 1; step <= 12; step++)
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: bounds.start.x + ((bounds.end.x - bounds.start.x) * step) / 12,
      y: bounds.start.y + ((bounds.end.y - bounds.start.y) * step) / 12,
      buttons: 1,
    });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...bounds.end,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  await wait(
    `document.querySelectorAll('.react-flow__node.selected').length===2`,
  );
  assert.deepEqual(await selected(), ['a', 'b']);
  await click(await point('a'), 'right');
  await wait('!!document.querySelector("[data-ui-id=selection-menu]")');
  assert.deepEqual(await selected(), ['a', 'b']);
  assert.ok(
    (
      await js(
        'document.querySelector("[data-ui-id=selection-menu]").textContent',
      )
    ).includes('2개 선택됨'),
  );
  const shot = await send('Page.captureScreenshot');
  await fs.mkdir('out/release-v0.36.0', { recursive: true });
  await fs.writeFile(
    'out/release-v0.36.0/selection-menu.png',
    Buffer.from(shot.data, 'base64'),
  );
  const beforeColorHistory = (await call('listHistory')).length;
  await js(
    `document.querySelector('[data-ui-id=selection-menu] [data-card-color=blue]').click()`,
  );
  await wait(
    `window.gameCanvas.listDocuments().then(d=>d.filter(x=>['a','b'].includes(x.id)).every(x=>x.backgroundColor==='blue'))`,
  );
  await wait(
    `document.querySelector('.status-toast')?.textContent.includes('배경색을 변경했습니다')`,
  );
  assert.equal((await call('listHistory')).length, beforeColorHistory + 1);
  assert.equal(
    (await call('listDocuments')).find((d) => d.id === 'c').backgroundColor,
    'default',
  );
  await js('document.activeElement?.blur()');
  await key('Z', ['control']);
  await wait(
    `window.gameCanvas.listDocuments().then(d=>d.filter(x=>['a','b'].includes(x.id)).every(x=>x.backgroundColor==='default'))`,
  );
  // Outside right click must replace the group and retain the original single-item menu.
  await click(await point('c'), 'right');
  await wait('!!document.querySelector("[data-ui-id=document-menu]")');
  assert.deepEqual(await selected(), ['c']);
  await key('Escape');
  await click(await point('a'));
  await wait(
    `document.querySelector('.react-flow__node[data-id="a"]').classList.contains('selected')`,
  );
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Shift',
    code: 'ShiftLeft',
    windowsVirtualKeyCode: 16,
    modifiers: 8,
  });
  await click(await point('b'), 'left', 8);
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Shift',
    code: 'ShiftLeft',
    windowsVirtualKeyCode: 16,
    modifiers: 0,
  });
  await wait(
    `document.querySelectorAll('.react-flow__node.selected').length===2`,
  );
  await click(await point('a'), 'right');
  await wait('!!document.querySelector("[data-ui-id=selection-menu]")');
  await js(
    `Array.from(document.querySelectorAll('[data-ui-id=selection-menu] button')).find(b=>b.textContent.includes('다른 프로젝트로 복사')).click()`,
  );
  await wait('!!document.querySelector("[data-ui-id=project-copy]")');
  const targetId = 'local:' + path.join(root, 'target').toLowerCase();
  await wait(
    `Array.from(document.querySelector('[aria-label="대상 프로젝트"]')?.options ?? []).some(o=>o.value===${JSON.stringify(targetId)})`,
  );
  await js(
    `(()=>{const e=document.querySelector('[aria-label="대상 프로젝트"]');e.value=${JSON.stringify(targetId)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await wait(`!!document.querySelector('[aria-label="대상 캔버스"]')`);
  const pickerShot = await send('Page.captureScreenshot');
  await fs.writeFile(
    'out/release-v0.36.0/project-copy-picker.png',
    Buffer.from(pickerShot.data, 'base64'),
  );
  await js(
    `Array.from(document.querySelectorAll('[data-ui-id=project-copy] button')).find(b=>b.textContent==='복사').click()`,
  );
  await wait(
    `document.querySelector('[data-ui-id=project-copy]').textContent.includes('2개 항목을 복사했습니다')`,
  );
  assert.deepEqual(await selected(), ['a', 'b']);
  const files = await captureProject(path.join(root, 'target'));
  const copies = snapshotDocuments(files),
    a = copies.find((d) => d.title === 'a'),
    b = copies.find((d) => d.title === 'b');
  assert.notEqual(a.id, 'a');
  assert.notEqual(b.id, 'b');
  assert.ok(a.body.includes(`gamejam://document/${b.id}`));
  const asset = Object.keys(files).find((p) => p.startsWith('assets/images/'));
  assert.deepEqual(decodeAsset(asset, files[asset]), png);
  const dialogShot = await send('Page.captureScreenshot');
  await fs.writeFile(
    'out/release-v0.36.0/project-copy-complete.png',
    Buffer.from(dialogShot.data, 'base64'),
  );
  await js(
    `Array.from(document.querySelectorAll('[data-ui-id=project-copy] button')).find(b=>b.textContent==='대상 프로젝트 열기').click()`,
  );
  await wait(
    `window.gameCanvas.getWorkspace().then(w=>w.root===${JSON.stringify(path.join(root, 'target'))})`,
  );
  await wait('!document.querySelector("[data-ui-id=project-copy]")');
  await wait(
    'document.querySelectorAll(".react-flow__node-document").length===3',
  );
  await call('undo');
  await wait('window.gameCanvas.listDocuments().then(d=>d.length===1)');
  await call('redo');
  await wait('window.gameCanvas.listDocuments().then(d=>d.length===3)');
  assert.equal(
    matter(await fs.readFile(path.join(game, 'docs/a.md'), 'utf8')).data.id,
    'a',
  );
  console.log(
    'PASS: packaged Shift and marquee selection, selected/outside right click, atomic bulk colors/Undo, project/canvas picker, independent image/document links, target Undo/Redo and source selection preservation',
  );
  return (await call('listDocuments')).map((d) => ({
    id: d.id,
    body: d.body,
    path: d.relativePath,
  }));
}

export async function projectCopyNativeScenarios({ call, wait, game, root }) {
  const localTargetId = 'local:' + path.join(root, 'target').toLowerCase(),
    localSourceId = 'local:' + game.toLowerCase();
  const server = await call('startLocalCollaborationServer');
  const sharedB = await call('createCollaboration', {
    serverUrl: server.serverUrl,
    serverKey: '',
    nickname: '복사 패키지 관리자',
  });
  const sharedBId = 'shared:' + sharedB.projectId;
  await call('openProject', localSourceId);
  const selection = {
    canvasId: 'default',
    documents: [{ id: 'a', path: 'docs/a.md' }],
    sections: [],
    previews: [],
    drawings: [],
  };
  let workspace = await call('getWorkspace');
  await call('copySelectionToProject', {
    session: workspace.session,
    requestId: crypto.randomUUID(),
    targetId: sharedBId,
    canvasId: 'default',
    selection,
  });
  const sharedA = await call('createCollaboration', {
    serverUrl: server.serverUrl,
    serverKey: '',
    nickname: '복사 패키지 관리자',
  });
  workspace = await call('getWorkspace');
  await call('copySelectionToProject', {
    session: workspace.session,
    requestId: crypto.randomUUID(),
    targetId: localTargetId,
    canvasId: 'default',
    selection,
  });
  await call('copySelectionToProject', {
    session: workspace.session,
    requestId: crypto.randomUUID(),
    targetId: sharedBId,
    canvasId: 'default',
    selection,
  });
  await call('openProject', sharedBId);
  assert.equal((await call('listDocuments')).length, 5);
  await call('openProject', 'shared:' + sharedA.projectId);
  assert.equal((await call('listDocuments')).length, 4);
  await call('openProject', localTargetId);
  await wait('window.gameCanvas.listDocuments().then(d=>d.length===4)');
  assert.equal(
    snapshotDocuments(await captureProject(path.join(root, 'target'))).length,
    4,
  );
  console.log(
    'PASS: packaged native IPC also confirms local→shared, shared→local and shared→shared through the bundled server without changing source content',
  );
  return (await call('listDocuments')).map((d) => ({
    id: d.id,
    body: d.body,
    path: d.relativePath,
  }));
}
