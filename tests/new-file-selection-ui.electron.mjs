import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { app, BrowserWindow } from 'electron';
app.setPath('userData', path.resolve('out/new-file-selection-ui/profile'));
async function run() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 1000,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      offscreen: true,
      backgroundThrottling: false,
    },
  });
  const js = (expression) => win.webContents.executeJavaScript(expression);
  const pause = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = async (expression) => {
    for (let i = 0; i < 150; i++) {
      if (await js(expression)) return;
      await pause();
    }
    throw Error('Timed out: ' + expression);
  };
  const mouse = async (type, point, modifiers = []) => {
    win.webContents.sendInputEvent({
      type,
      x: Math.round(point.x),
      y: Math.round(point.y),
      button: 'left',
      clickCount: 1,
      modifiers,
    });
    await pause();
  };
  const drag = async (selector, count) => {
    const box = await js(
      `(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})].slice(0,${count}).map(n=>n.getBoundingClientRect());const box={left:Math.min(...nodes.map(r=>r.left))-8,top:Math.min(...nodes.map(r=>r.top))-8,right:Math.max(...nodes.map(r=>r.right))+8,bottom:Math.max(...nodes.map(r=>r.bottom))+8};for(let i=0;i<25;i++){if(document.elementFromPoint(box.left,box.top)?.classList.contains('react-flow__pane'))break;box.left-=8;box.top-=8;}return box;})()`,
    );
    assert.ok(
      await js(
        `document.elementFromPoint(${box.left},${box.top})?.classList.contains('react-flow__pane')`,
      ),
      'marquee starts on the pane without clicking a card',
    );
    await mouse('mouseDown', { x: box.left, y: box.top });
    // Stay outside the running HTML iframe so native input remains in the canvas.
    for (let i = 1; i <= 8; i++)
      await mouse(
        'mouseMove',
        {
          x: box.left + ((box.right - box.left) * i) / 8,
          y: box.top,
        },
        ['leftButtonDown'],
      );
    for (let i = 1; i <= 8; i++)
      await mouse(
        'mouseMove',
        {
          x: box.right,
          y: box.top + ((box.bottom - box.top) * i) / 8,
        },
        ['leftButtonDown'],
      );
    await mouse('mouseUp', { x: box.right, y: box.bottom });
  };
  try {
    await win.loadURL(process.env.QA_URL);
    await js('localStorage.clear()');
    await win.loadURL(process.env.QA_URL);
    await wait(
      '!!window.gameCanvas && !!document.querySelector(".home-project-open")',
    );
    await js(
      `(async()=>{const w=await window.gameCanvas.getWorkspace(),docs=await window.gameCanvas.listDocuments(),previews=await window.gameCanvas.listPreviews();const ids=[...docs.filter(d=>d.type!=='ai-task').map(d=>d.id),...previews.map(p=>'preview:'+p.relativePath)];localStorage.setItem('game-canvas-new-files:'+w.root,JSON.stringify({known:ids,unread:ids}));})()`,
    );
    await win.loadURL(process.env.QA_URL);
    await wait('!!document.querySelector(".home-project-open")');
    await js('document.querySelector(".home-project-open").click()');
    await wait('document.querySelectorAll(".new-file-node").length===4');
    await js(
      `document.querySelector('button[title^="캔버스 전체 보기"]').click()`,
    );
    await pause(450);
    await drag('.react-flow__node-document', 2);
    await wait(
      'document.querySelectorAll(".react-flow__node-document.selected").length===2',
    );
    await wait(
      'document.querySelectorAll(".react-flow__node-document.new-file-node").length===1',
    );
    assert.equal(
      await js(
        'document.querySelectorAll(".react-flow__node-preview.new-file-node").length',
      ),
      1,
      'unselected HTML keeps its unread glow',
    );
    // Keyboard selection also acknowledges the remaining document.
    for (const type of ['keyDown', 'keyUp'])
      win.webContents.sendInputEvent({
        type,
        keyCode: 'A',
        modifiers: ['control'],
      });
    await wait(
      'document.querySelectorAll(".react-flow__node-document.selected").length===3',
    );
    await wait(
      'document.querySelectorAll(".react-flow__node-document.new-file-node").length===0',
    );
    assert.equal(
      await js(
        'document.querySelectorAll(".react-flow__node-preview.new-file-node").length',
      ),
      1,
    );
    // HTML can also be selected through the node's keyboard accessibility path.
    await js('document.querySelector(".react-flow__node-preview").focus()');
    for (const type of ['keyDown', 'keyUp'])
      win.webContents.sendInputEvent({ type, keyCode: 'Enter' });
    await wait(
      '!!document.querySelector(".react-flow__node-preview.selected")',
    );
    await wait('document.querySelectorAll(".new-file-node").length===0');
    // Deselecting and remounting must not recreate the acknowledgement markers.
    await mouse('mouseDown', { x: 350, y: 100 });
    await mouse('mouseUp', { x: 350, y: 100 });
    assert.equal(
      await js('document.querySelectorAll(".new-file-node").length'),
      0,
    );
    const unread = await js(
      `(async()=>{const w=await window.gameCanvas.getWorkspace();return JSON.parse(localStorage.getItem('game-canvas-new-files:'+w.root)).unread})()`,
    );
    assert.deepEqual(unread, []);
    await win.loadURL(process.env.QA_URL);
    await wait('!!document.querySelector(".home-project-open")');
    await js('document.querySelector(".home-project-open").click()');
    await wait(
      'document.querySelectorAll(".react-flow__node-document").length===3',
    );
    assert.equal(
      await js('document.querySelectorAll(".new-file-node").length'),
      0,
    );
    console.log(
      'PASS: native marquee/Ctrl+A acknowledge documents, keyboard selection acknowledges HTML, unread items outside selection remain highlighted, and acknowledgement persists after deselection/reload.',
    );
  } catch (error) {
    await fs.mkdir('out/new-file-selection-ui', { recursive: true });
    await fs.writeFile(
      'out/new-file-selection-ui/failure.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    console.error(
      await js(
        '({nodes:[...document.querySelectorAll(".react-flow__node")].map(n=>({id:n.dataset.id,classes:n.className,rect:n.getBoundingClientRect().toJSON()})),body:document.body.innerText.slice(-700)})',
      ),
    );
    throw error;
  } finally {
    win.destroy();
    app.quit();
  }
}
void run().catch((error) => {
  console.error(error);
  app.exit(1);
});
