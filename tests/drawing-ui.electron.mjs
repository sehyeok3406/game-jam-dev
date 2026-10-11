import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
app.setPath('userData', path.resolve('out/drawing-ui/profile'));
async function run() {
  await app.whenReady();
  await fs.mkdir('out/drawing-ui', { recursive: true });
  const win = new BrowserWindow({
    show: false,
    width: 1360,
    height: 1000,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
      offscreen: true,
    },
  });
  const errors = [];
  win.webContents.on('console-message', (d) => {
    if (
      d.level === 'error' &&
      !d.message.startsWith(
        'ResizeObserver loop completed with undelivered notifications',
      )
    )
      errors.push(d.message);
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  const pause = () => new Promise((r) => setTimeout(r, 70));
  const wait = async (code) => {
    for (let i = 0; i < 130; i++) {
      if (await js(code)) return;
      await pause();
    }
    throw Error('Timed out: ' + code);
  };
  const key = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await pause();
  };
  const mouse = async (type, x, y, modifiers = []) => {
    win.webContents.sendInputEvent({
      type,
      x: Math.round(x),
      y: Math.round(y),
      button: 'left',
      clickCount: 1,
      modifiers,
    });
    await pause();
  };
  const drag = async (a, b, modifiers = []) => {
    await mouse('mouseMove', a.x, a.y);
    await mouse('mouseDown', a.x, a.y, modifiers);
    for (let i = 1; i <= 8; i++)
      await mouse(
        'mouseMove',
        a.x + ((b.x - a.x) * i) / 8,
        a.y + ((b.y - a.y) * i) / 8,
        [...modifiers, 'leftButtonDown'],
      );
    await mouse('mouseUp', b.x, b.y, modifiers);
  };
  const center = (selector) =>
    js(
      `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
  const count = () =>
    js('(async()=> (await window.gameCanvas.listDrawings()).length)()');
  try {
    await win.loadURL(process.env.QA_URL);
    await js('localStorage.clear()');
    await win.loadURL(process.env.QA_URL);
    await wait('!!document.querySelector(".home-project-open")');
    await js('document.querySelector(".home-project-open").click()');
    await wait(
      'document.querySelectorAll(".react-flow__node-document").length===3',
    );
    // An empty canvas avoids fitting the test geometry to the demo documents.
    await js(
      `(async()=>{const s=await window.gameCanvas.getCanvasSheets();await window.gameCanvas.changeCanvasSheets({action:'add',id:'drawing-test',name:'그림 테스트',expected:s.raw})})()`,
    );
    await wait('document.querySelectorAll("[role=tab]").length===2');
    await js(
      'Array.from(document.querySelectorAll("[role=tab]")).find(e=>e.textContent.includes("그림 테스트")).click()',
    );
    await wait('document.querySelectorAll(".react-flow__node").length===0');
    await key('r');
    await wait('!!document.querySelector(".drawing-input-layer")');
    await drag({ x: 240, y: 230 }, { x: 440, y: 370 }, ['shift']);
    await wait(
      'document.querySelectorAll(".canvas-drawing-node").length===1 && !!document.querySelector("[data-handle=se]")',
    );
    let first = await js(
      '(async()=> (await window.gameCanvas.listDrawings())[0])()',
    );
    assert.equal(first.transform.width, first.transform.height);
    assert.equal(first.canvasId, 'drawing-test');
    await new Promise((r) => setTimeout(r, 350));
    assert.equal(
      await js(
        'getComputedStyle(document.querySelector(".canvas-drawing-node")).zIndex',
      ),
      '1',
    );
    const se = await center('[data-handle=se]');
    await drag(se, { x: se.x + 80, y: se.y + 40 });
    await wait(
      `(async()=> (await window.gameCanvas.listDrawings())[0].transform.width>${first.transform.width + 60})()`,
    );
    first = await js(
      '(async()=> (await window.gameCanvas.listDrawings())[0])()',
    );
    const rotation = await center('[data-handle=rotate]');
    await drag(rotation, { x: rotation.x + 120, y: rotation.y + 120 }, [
      'shift',
    ]);
    await wait(
      '(async()=> (await window.gameCanvas.listDrawings())[0].transform.rotation>0)()',
    );
    first = await js(
      '(async()=> (await window.gameCanvas.listDrawings())[0])()',
    );
    assert.equal(first.transform.rotation % 15, 0);
    await key('z', ['control']);
    await wait(
      '(async()=> (await window.gameCanvas.listDrawings())[0].transform.rotation===0)()',
    );
    await key('z', ['control', 'shift']);
    await wait(
      '(async()=> (await window.gameCanvas.listDrawings())[0].transform.rotation>0)()',
    );
    await key('Escape');
    await key('p', ['shift']);
    await wait('!!document.querySelector(".drawing-input-layer--pen")');
    await drag({ x: 600, y: 480 }, { x: 900, y: 540 });
    await wait(
      '(async()=> (await window.gameCanvas.listDrawings()).length===2)()',
    );
    assert.ok(
      (
        await js(
          '(async()=> (await window.gameCanvas.listDrawings()).find(o=>o.kind==="stroke"))()',
        )
      ).geometry.points.length >= 8,
    );
    await key('e');
    await drag({ x: 760, y: 400 }, { x: 760, y: 600 });
    await wait(
      '(async()=> (await window.gameCanvas.listDrawings()).length===1)()',
    );
    await key('z', ['control']);
    await wait(
      '(async()=> (await window.gameCanvas.listDrawings()).length===2)()',
    );
    // Escape aborts a captured gesture and leaves existing objects unchanged.
    await key('p', ['shift']);
    await mouse('mouseDown', 650, 620);
    await mouse('mouseMove', 850, 680);
    await key('Escape');
    await mouse('mouseUp', 850, 680);
    assert.equal(await count(), 2);
    // Real card + drawing selection must cancel and undo together.
    await key('Escape');
    await js(
      `window.gameCanvas.createIdea({canvasId:'drawing-test',x:450,y:450})`,
    );
    await wait(
      'document.querySelectorAll(".react-flow__node-document").length===1',
    );
    await key('a', ['control']);
    await key('Delete');
    await wait('!!document.querySelector("[data-ui-id=delete-many]")');
    await js(
      'Array.from(document.querySelectorAll("[data-ui-id=delete-many] button")).find(b=>b.textContent.trim()==="취소").click()',
    );
    assert.equal(await count(), 2);
    await key('Delete');
    await wait('!!document.querySelector("[data-ui-id=delete-many]")');
    await js(
      'document.querySelector("[data-ui-id=delete-many] .button-danger").click()',
    );
    await wait(
      '(async()=> (await window.gameCanvas.listDrawings()).length===0)()',
    );
    await wait(
      'document.querySelectorAll(".react-flow__node-document").length===0',
    );
    await key('z', ['control']);
    await wait(
      'document.querySelectorAll(".canvas-drawing-node").length===2 && document.querySelectorAll(".react-flow__node-document").length===1',
    );
    // A save failure retains the optimistic object and recoverable draft, then retries.
    await js(
      `window.qaSave=window.gameCanvas.applyDrawingCommand;window.gameCanvas.applyDrawingCommand=async()=>{throw Error('QA 저장 실패')};void 0`,
    );
    await key('o');
    await drag({ x: 640, y: 280 }, { x: 820, y: 390 });
    await wait(
      'document.querySelector(".drawing-save-alert")?.textContent.includes("저장 실패")',
    );
    assert.ok(
      await js(
        '(async()=>!!(await window.gameCanvas.getEditorDraft("drawing:local:dev-workspace")))()',
      ),
    );
    await js(
      'window.gameCanvas.applyDrawingCommand=window.qaSave;Array.from(document.querySelectorAll(".drawing-save-alert button")).find(b=>b.textContent.includes("재시도")).click()',
    );
    await wait(
      '(async()=> (await window.gameCanvas.listDrawings()).length===3)()',
    );
    await wait('!document.querySelector(".drawing-save-alert")');
    assert.equal(
      await js(
        '(async()=>await window.gameCanvas.getEditorDraft("drawing:local:dev-workspace"))()',
      ),
      null,
    );
    // Holding a failed draft must not let a later successful save erase it.
    await js(
      `window.gameCanvas.applyDrawingCommand=async()=>{throw Error('QA 보류')};void 0`,
    );
    await key('t');
    await drag({ x: 880, y: 240 }, { x: 1010, y: 360 });
    await wait(
      'document.querySelector(".drawing-save-alert")?.textContent.includes("QA 보류")',
    );
    await js(
      'Array.from(document.querySelectorAll(".drawing-save-alert button")).find(b=>b.textContent.includes("보류")).click()',
    );
    await wait(
      'document.querySelector(".drawing-save-alert")?.textContent.includes("초안 복구")',
    );
    await js('window.gameCanvas.applyDrawingCommand=window.qaSave;void 0');
    await key('r');
    await drag({ x: 900, y: 390 }, { x: 1020, y: 430 });
    await wait(
      '(async()=> (await window.gameCanvas.listDrawings()).length===4)()',
    );
    assert.ok(
      await js(
        '(async()=>JSON.parse((await window.gameCanvas.getEditorDraft("drawing:local:dev-workspace")).body).length>0)()',
      ),
    );
    await js(
      'Array.from(document.querySelectorAll(".drawing-save-alert button")).find(b=>b.textContent.includes("초안 복구")).click()',
    );
    await wait(
      '(async()=> (await window.gameCanvas.listDrawings()).length===5)()',
    );
    await wait('!document.querySelector(".drawing-save-alert")');
    // A hollow annotation above a card passes clicks through its empty interior.
    await js(`(async()=>{const scope=(await window.gameCanvas.getWorkspace()).saveScope;await window.gameCanvas.applyDrawingCommand({scope,canvasId:'drawing-test',action:'create',objects:[{
      id:crypto.randomUUID(),generation:crypto.randomUUID(),kind:'shape',geometry:{shape:'rectangle'},transform:{x:420,y:420,width:400,height:360,rotation:0},
      style:{fill:null,stroke:'#ff0000',strokeWidth:2,opacity:1,strokePattern:'solid'},layer:'annotation',order:100,createdAt:1,updatedAt:1}]})})()`);
    await wait('document.querySelectorAll(".canvas-drawing-node").length===6');
    await key('Escape');
    assert.ok(
      await js(
        '!!document.elementFromPoint(500,600)?.closest(".document-card")',
      ),
    );
    // Alt+right-click finds that hollow shape and the card below it.
    win.webContents.sendInputEvent({
      type: 'mouseDown',
      x: 500,
      y: 600,
      button: 'right',
      clickCount: 1,
      modifiers: ['alt'],
    });
    win.webContents.sendInputEvent({
      type: 'mouseUp',
      x: 500,
      y: 600,
      button: 'right',
      clickCount: 1,
      modifiers: ['alt'],
    });
    await wait('!!document.querySelector(".drawing-overlap-menu")');
    assert.ok(
      await js(
        'document.querySelector(".drawing-overlap-menu").textContent.includes("사각형") && document.querySelector(".drawing-overlap-menu").textContent.includes("새 아이디어")',
      ),
    );
    await js(
      'Array.from(document.querySelectorAll(".drawing-overlap-menu button")).find(b=>b.textContent.includes("사각형")).click()',
    );
    await wait('!!document.querySelector(".drawing-handles")');
    // A peer's geometry edit during our resize must survive the transform save.
    const peerObject = await js(
      '(async()=>{const id=document.querySelector(".canvas-drawing-node.selected").dataset.id.slice(8);return (await window.gameCanvas.listDrawings()).find(o=>o.id===id)})()',
    );
    const handle = await center('[data-handle=se]');
    await mouse('mouseDown', handle.x, handle.y);
    await mouse('mouseMove', handle.x + 10, handle.y + 10, ['leftButtonDown']);
    await js(
      `window.gameCanvas.applyDrawingCommand({scope:'local:dev-workspace',canvasId:'drawing-test',action:'patch',patches:[{id:${JSON.stringify(peerObject.id)},generation:${JSON.stringify(peerObject.generation)},geometry:{shape:'diamond'},expectedGeometry:${JSON.stringify(peerObject.geometry)}}]})`,
    );
    await wait(
      'document.querySelector(".drawing-inspector h3")?.textContent.includes("마름모")',
    );
    await js(
      '(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})()',
    );
    await mouse('mouseMove', handle.x + 40, handle.y + 30, ['leftButtonDown']);
    await mouse('mouseUp', handle.x + 40, handle.y + 30);
    await wait('!document.querySelector(".drawing-save-alert")');
    assert.equal(
      await js(
        `(async()=> (await window.gameCanvas.listDrawings()).find(o=>o.id===${JSON.stringify(peerObject.id)}).geometry.shape)()`,
      ),
      'diamond',
    );
    // Competing endpoint edits must report a conflict and retain a draft,
    // without an uncaught event error or overwriting the peer's endpoint.
    const line = {
      shape: 'line',
      endpoints: [
        [0, 0],
        [1, 1],
      ],
    };
    await js(
      `window.gameCanvas.applyDrawingCommand({scope:'local:dev-workspace',canvasId:'drawing-test',action:'patch',patches:[{id:${JSON.stringify(peerObject.id)},generation:${JSON.stringify(peerObject.generation)},geometry:${JSON.stringify(line)},expectedGeometry:{shape:'diamond'}}]})`,
    );
    await wait('!!document.querySelector("[data-handle=end1]")');
    const tip = await center('[data-handle=end1]');
    await mouse('mouseDown', tip.x, tip.y);
    await mouse('mouseMove', tip.x + 10, tip.y + 10, ['leftButtonDown']);
    await js(
      `window.gameCanvas.applyDrawingCommand({scope:'local:dev-workspace',canvasId:'drawing-test',action:'patch',patches:[{id:${JSON.stringify(peerObject.id)},generation:${JSON.stringify(peerObject.generation)},geometry:{shape:'line',endpoints:[[0,0],[0.5,1]]},expectedGeometry:${JSON.stringify(line)}}]})`,
    );
    await pause();
    await mouse('mouseMove', tip.x + 30, tip.y + 20, ['leftButtonDown']);
    await mouse('mouseUp', tip.x + 30, tip.y + 20);
    await wait(
      'document.querySelector(".drawing-save-alert")?.textContent.includes("모양이 변경")',
    );
    assert.deepEqual(
      await js(
        `(async()=> (await window.gameCanvas.listDrawings()).find(o=>o.id===${JSON.stringify(peerObject.id)}).geometry.endpoints)()`,
      ),
      [
        [0, 0],
        [0.5, 1],
      ],
    );
    assert.ok(
      await js(
        '(async()=> !!(await window.gameCanvas.getEditorDraft("drawing:local:dev-workspace")))()',
      ),
    );
    await js(
      'Array.from(document.querySelectorAll(".drawing-save-alert button")).find(b=>b.textContent.includes("초안 버리기")).click()',
    );
    await wait('!document.querySelector(".drawing-save-alert")');
    await js('document.documentElement.dataset.theme="dark"');
    await pause();
    await fs.writeFile(
      'out/drawing-ui/dark.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    await js('document.documentElement.dataset.theme="light"');
    await pause();
    await fs.writeFile(
      'out/drawing-ui/light.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    win.setSize(1024, 768);
    await pause();
    await fs.writeFile(
      'out/drawing-ui/compact.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    assert.ok(
      await js(
        '(()=>{const r=document.querySelector(".bottom-toolbar").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()',
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS: Electron native input creates constrained shapes, resizes, rotates, draws/erases strokes, cancels gestures, atomically deletes mixed selections, undoes and retries failed saves. Dark/light/compact screenshots saved.',
    );
  } catch (error) {
    console.log(
      await js(
        '(async()=>({drawings:await window.gameCanvas.listDrawings(),alert:document.querySelector(".drawing-save-alert")?.textContent,body:document.body.innerText.slice(-1000),handles:document.querySelectorAll("[data-handle]").length,nodes:[...document.querySelectorAll(".react-flow__node")].map(n=>({id:n.dataset.id,selected:n.classList.contains("selected")}))}))()',
      ),
    );
    await fs.writeFile(
      'out/drawing-ui/failure.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    throw error;
  } finally {
    win.destroy();
    app.quit();
  }
}
void run().catch((e) => {
  console.error(e);
  app.exit(1);
});
