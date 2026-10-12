import assert from 'node:assert/strict';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';

app.setPath('userData', path.resolve('out/canvas-selection-ui/profile'));
async function run() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      offscreen: true,
      backgroundThrottling: false,
    },
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = async (code) => {
    for (let i = 0; i < 120; i++) {
      if (await js(code)) return;
      await sleep(50);
    }
    throw Error('UI timed out: ' + code);
  };
  const pointer = (type, point) =>
    win.webContents.sendInputEvent({
      type,
      ...point,
      button: 'left',
      clickCount: 1,
    });
  const key = (type, keyCode, modifiers = []) =>
    win.webContents.sendInputEvent({ type, keyCode, modifiers });
  const selected = () =>
    js(
      `Array.from(document.querySelectorAll('.react-flow__node.selected')).map(n=>n.dataset.id).sort()`,
    );
  const selectionVisible = '!!document.querySelector(".react-flow__selection")';
  const toolIs = (tool) =>
    `document.querySelector('.app-shell').classList.contains('app-shell--tool-${tool}')`;
  const viewport = () =>
    js(`document.querySelector('.react-flow__viewport').style.transform`);
  let exitCode = 0;
  try {
    await win.loadURL(process.env.QA_URL);
    await js('localStorage.clear();sessionStorage.clear()');
    await win.loadURL(process.env.QA_URL);
    await wait('!!document.querySelector(".home-project-open")');
    await js('document.querySelector(".home-project-open").click()');
    await wait(
      'document.querySelectorAll(".react-flow__node-document").length > 0',
    );
    await sleep(300);
    // Find an unobstructed patch of the actual pane, away from auto-pan edges.
    const start = await js(`(()=>{
    const pane=document.querySelector('.react-flow__pane'), r=pane.getBoundingClientRect();
    for(let y=Math.ceil(r.top)+100;y<r.bottom-180;y+=40)
      for(let x=Math.ceil(r.left)+100;x<r.right-220;x+=40)
        if([[0,0],[120,0],[0,100],[120,100],[60,50]].every(([dx,dy])=>document.elementFromPoint(x+dx,y+dy)===pane))
          return {x,y};
    throw Error('No empty pane patch found');
  })()`);
    const end = { x: start.x + 90, y: start.y + 70 };
    const farther = { x: start.x + 120, y: start.y + 100 };
    // Both mouse-release orders must cancel, including a pending click before movement.
    for (const [releaseWhilePanning, moveBeforeSpace] of [
      [false, true],
      [true, true],
      [false, false],
    ]) {
      key('keyDown', 'A', ['control']);
      key('keyUp', 'A', ['control']);
      await wait(
        'document.querySelectorAll(".react-flow__node.selected").length > 0',
      );
      const before = await selected();
      pointer('mouseDown', start);
      await sleep(50);
      if (moveBeforeSpace) {
        pointer('mouseMove', end);
        await wait(selectionVisible);
        assert.deepEqual(
          await selected(),
          [],
          'empty marquee clears the temporary selection',
        );
      }
      key('keyDown', 'Space');
      await wait(toolIs('hand'));
      assert.equal(
        await js(selectionVisible),
        false,
        'Space cancels the selection rectangle immediately',
      );
      assert.deepEqual(
        await selected(),
        before,
        'cancel restores the selection before the gesture',
      );
      pointer('mouseMove', farther);
      await sleep(80);
      if (releaseWhilePanning) pointer('mouseUp', farther);
      key('keyUp', 'Space');
      await wait(toolIs('select'));
      pointer('mouseMove', end);
      await sleep(80);
      assert.equal(
        await js(selectionVisible),
        false,
        'releasing Space never resumes the old drag',
      );
      if (!releaseWhilePanning) pointer('mouseUp', end);
      await sleep(80);
      assert.equal(
        await js(selectionVisible),
        false,
        'mouse release leaves no stuck rectangle',
      );
      assert.deepEqual(await selected(), before);
      // The next complete gesture still selects normally.
      pointer('mouseDown', start);
      pointer('mouseMove', end);
      await wait(selectionVisible);
      pointer('mouseUp', end);
      await wait('!' + selectionVisible);
      assert.deepEqual(await selected(), []);
    }
    // A new drag begun while holding Space still pans the canvas.
    key('keyDown', 'Space');
    await wait(toolIs('hand'));
    const beforePan = await viewport();
    pointer('mouseDown', start);
    pointer('mouseMove', end);
    await wait(
      `document.querySelector('.react-flow__viewport').style.transform !== ${JSON.stringify(beforePan)}`,
    );
    pointer('mouseUp', end);
    key('keyUp', 'Space');
    await wait(toolIs('select'));
    assert.equal(await js(selectionVisible), false);
    // Cancellation also stops the selection's animation loop at a canvas edge.
    const edge = await js(`(()=>{
      const pane=document.querySelector('.react-flow__pane'), r=pane.getBoundingClientRect();
      const x=Math.floor(r.right)-8;
      for(let y=Math.ceil(r.top)+100;y<r.bottom-100;y+=40)
        if(document.elementFromPoint(x,y)===pane && document.elementFromPoint(x-80,y)===pane)
          return {x,y};
      throw Error('No empty pane edge found');
    })()`);
    const beforeAutoPan = await viewport();
    pointer('mouseDown', { x: edge.x - 80, y: edge.y });
    pointer('mouseMove', edge);
    await wait(selectionVisible);
    await wait(
      `document.querySelector('.react-flow__viewport').style.transform !== ${JSON.stringify(beforeAutoPan)}`,
    );
    key('keyDown', 'Space');
    await wait(toolIs('hand'));
    await sleep(80);
    const cancelledViewport = await viewport();
    await sleep(150);
    assert.equal(
      await viewport(),
      cancelledViewport,
      'cancel stops selection auto-pan',
    );
    key('keyUp', 'Space');
    await wait(toolIs('select'));
    await sleep(150);
    assert.equal(
      await viewport(),
      cancelledViewport,
      'Space release does not restart auto-pan',
    );
    assert.equal(await js(selectionVisible), false);
    pointer('mouseUp', edge);
    console.log(
      'Canvas selection UI QA passed: Space cancels active/pending selection, both release orders, next selection, pan and auto-pan cleanup.',
    );
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    win.destroy();
    app.exit(exitCode);
  }
}
run().catch((error) => {
  console.error(error);
  app.exit(1);
});
