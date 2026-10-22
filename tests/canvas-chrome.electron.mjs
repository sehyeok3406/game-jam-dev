import { assertCanvasToolbar } from './canvas-toolbar-check.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
app.disableHardwareAcceleration();
app.setPath('userData', path.resolve('out/canvas-chrome/profile'));
async function run() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      offscreen: true,
      backgroundThrottling: false,
    },
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  const pause = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
  const errors = [];
  win.webContents.on('console-message', (_event, details) => {
    if (details.level === 'error') errors.push(details.message);
  });
  const wait = async (code) => {
    for (let n = 0; n < 180; n++) {
      if (await js(code)) return;
      await pause();
    }
    throw Error('Timeout: ' + code + '\n' + errors.join('\n'));
  };
  const click = (selector) =>
    js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const capture = async (name) => {
    await pause(150);
    await fs.writeFile(
      `out/canvas-chrome/${name}.png`,
      (await win.webContents.capturePage()).toPNG(),
    );
  };
  const unobscured = async () => {
    await assertCanvasToolbar(js);
    const result = await js(`(()=>{
    const selectors=['.header-undo button','.canvas-utility [aria-label="축소"]','.canvas-utility [aria-label="확대"]','.canvas-utility [aria-label="캔버스 전체 맞춤"]'];
    return selectors.filter(s=>document.querySelector(s)).map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {s,visible:r.width>=30&&r.height>=30&&r.x>=0&&r.bottom<=innerHeight,hit:hit===e||e.contains(hit)};});
  })()`);
    assert.equal(result.length, 4);
    for (const item of result)
      assert.ok(item.visible && item.hit, JSON.stringify(item));
    assert.ok(
      await js(
        `(()=>{const c=document.querySelector('.canvas-shell').getBoundingClientRect(),p=document.querySelector('.canvas-dock')?.getBoundingClientRect();return !p||c.right<=p.left+1;})()`,
      ),
    );
  };
  let code = 0;
  try {
    await fs.mkdir('out/canvas-chrome', { recursive: true });
    await win.loadURL(
      process.env.QA_URL.replace(
        'ai-queue.fixture.html',
        'ui-review.fixture.html',
      ),
    );
    await js('localStorage.clear(); sessionStorage.clear()');
    await win.reload();
    await wait('!!document.querySelector(".home-project-open")');
    assert.ok(
      await js(
        '!!document.querySelector(".home-sidebar-bottom button svg.lucide-trash-2")',
      ),
    );
    assert.equal(
      await js('document.querySelector(".home-add-dialog").open'),
      false,
    );
    await capture('home');
    await click('.home-heading .button-primary');
    await wait('document.querySelector(".home-add-dialog").open');
    assert.equal(
      await js(
        'document.querySelectorAll(".home-add-dialog .home-entry-actions button").length',
      ),
      3,
    );
    await capture('project-add');
    await click('[aria-label="프로젝트 추가 닫기"]');
    await click('.home-project-open');
    await wait('!!document.querySelector(".document-card")');
    assert.equal(await js('!!document.querySelector(".canvas-dock")'), false);
    assert.equal(
      await js('!!document.querySelector(".canvas-minimap-panel")'),
      false,
    );
    for (const size of [
      [980, 640],
      [1280, 720],
      [1920, 1080],
    ]) {
      win.setSize(...size);
      await pause();
      await unobscured();
      await click('[aria-label="AI 작업 패널"]');
      await wait('!!document.querySelector(".canvas-dock")');
      await unobscured();
      await click('[title="문서 목록 (L)"]');
      await pause();
      await unobscured();
      await click('[title="문서 목록 (L)"]');
      await pause();
      await capture(`canvas-ai-${size[0]}`);
      for (const group of [
        '.drawing-tool-menu',
        '.canvas-drawing-group',
        '.canvas-tool-more',
      ]) {
        await click(group + ' > summary');
        const menu = await js(
          `(()=>{const r=document.querySelector('${group} > div').getBoundingClientRect(),b=document.querySelector('.bottom-toolbar').getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,barTop:b.top,width:innerWidth};})()`,
        );
        assert.ok(
          menu.top >= 0 &&
            menu.bottom <= menu.barTop &&
            menu.left >= 0 &&
            menu.right <= menu.width,
          JSON.stringify(menu),
        );
        if (group === '.canvas-drawing-group') {
          await click('[data-ui-id="drawing-eraser"] > button');
          await wait('!!document.querySelector(".drawing-eraser-menu__popup")');
          const eraser = await js(
            '(()=>{const r=document.querySelector(".drawing-eraser-menu__popup").getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:innerWidth,height:innerHeight};})()',
          );
          assert.ok(
            eraser.top >= 0 &&
              eraser.bottom <= eraser.height &&
              eraser.left >= 0 &&
              eraser.right <= eraser.width,
            JSON.stringify(eraser),
          );
          await js(
            'window.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape"}))',
          );
          await wait('!document.querySelector(".drawing-eraser-menu__popup")');
        }
        await click(group + ' > summary');
      }

      await click('[aria-label="작업 패널 닫기"]');
      if (size[0] === 980) {
        await click('[aria-label="미니맵 전환"]');
        await wait(
          '!!document.querySelector(".canvas-dock .canvas-minimap-panel")',
        );
        await unobscured();
        await click('[aria-label="작업 패널 닫기"]');
      }
    }
    win.setSize(1280, 800);
    await click('[aria-label="미니맵 전환"]');
    await wait('!!document.querySelector(".canvas-minimap-panel")');
    await unobscured();
    await click('[aria-label="미니맵 전환"]');
    const z = await js(
      'document.querySelector(".canvas-zoom-menu summary").textContent',
    );
    await click('[aria-label="축소"]');
    await pause(350);
    assert.notEqual(
      await js(
        'document.querySelector(".canvas-zoom-menu summary").textContent',
      ),
      z,
    );
    await click('.ui-tools-toggle');
    await wait('!!document.querySelector(".canvas-workspace--focus")');
    assert.equal(
      await js(
        'getComputedStyle(document.querySelector(".bottom-toolbar")).display',
      ),
      'none',
    );
    assert.ok(
      await js(
        'document.querySelector(".canvas-shell").getBoundingClientRect().width>=innerWidth-1',
      ),
    );
    await click('.ui-tools-toggle');
    await unobscured();
    await click('[aria-label="도형 삽입"]');
    await js(
      'document.querySelector(".drawing-tool-menu__items button").click()',
    );
    await wait('!!document.querySelector(".canvas-dock .drawing-inspector")');
    await unobscured();
    await capture('canvas-properties');
    await click('[aria-label="협업 패널"]');
    await wait('!!document.querySelector(".canvas-collaboration")');
    assert.equal(
      await js('document.querySelectorAll(".canvas-dock").length'),
      1,
    );
    await click('[aria-label="작업 패널 닫기"]');
    await win.loadURL(process.env.QA_URL);
    await wait('!!document.querySelector(".document-card")');
    await js(
      'Promise.all([qaQueue.enqueue(),qaQueue.enqueue(),qaQueue.enqueue()])',
    );
    await wait(
      'document.querySelector(".canvas-ai-summary").textContent.includes("예약")',
    );
    assert.equal(
      await js('!!document.querySelector(".ai-queue-panel")'),
      false,
    );
    await click('[aria-label="AI 작업 패널"]');
    await wait(
      'document.querySelectorAll(".canvas-dock .ai-queue-panel li").length>=2',
    );
    await unobscured();
    await capture('canvas-ai-running');
    await click('[aria-label="작업 패널 닫기"]');
    await wait('!document.querySelector(".canvas-dock")');
    await unobscured();
    assert.equal(
      errors.filter((e) => /Uncaught|Maximum update depth|TypeError/.test(e))
        .length,
      0,
      errors.join('\n'),
    );
    console.log(
      'PASS: project entry choices, trash icon, reserved controls, min-size layouts, minimap, focus restore, properties, collaboration and active AI queue',
    );
  } catch (error) {
    code = 1;
    console.error(error);
    await capture('failure');
  } finally {
    win.destroy();
    app.exit(code);
  }
}
run().catch((error) => {
  console.error(error);
  app.exit(1);
});
