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
  const key = (type, keyCode, modifiers = []) =>
    win.webContents.sendInputEvent({ type, keyCode, modifiers });
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
    await wait('!!document.querySelector(".file-node-surface--md")');
    assert.equal(await js('!!document.querySelector(".canvas-dock")'), false);
    assert.equal(
      await js('!!document.querySelector(".canvas-minimap-panel")'),
      false,
    );
    const htmlSurface = '.file-node-surface--html';
    const htmlCenter = `(() => {
      const surface = document.querySelector('${htmlSurface}');
      if (!surface) return;
      const rect = surface.getBoundingClientRect();
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + rect.height / 2);
      if (surface.contains(document.elementFromPoint(x, y))) return { x, y };
    })()`;
    const clickHtmlNode = async () => {
      await wait(htmlCenter);
      const point = await js(htmlCenter);
      for (const type of ['mouseDown', 'mouseUp']) {
        win.webContents.sendInputEvent({
          type,
          button: 'left',
          clickCount: 1,
          ...point,
        });
      }
    };
    await clickHtmlNode();
    await wait(
      '!!document.querySelector(".react-flow__node-preview.selected")',
    );
    assert.ok(await js(`!!document.querySelector('${htmlSurface}')`));
    await clickHtmlNode();
    await wait(`!document.querySelector('${htmlSurface}')`);
    await click('.preview-card button[title="HTML 창 최소화"]');
    await wait(`!!document.querySelector('${htmlSurface}')`);

    const draw = '.canvas-drawing-control > button';
    const drawOptions = '.canvas-drawing-group';
    await click(draw);
    await wait(
      `document.querySelector('${draw}').getAttribute('aria-pressed') === 'true'`,
    );
    assert.equal(
      await js(`document.querySelector('${drawOptions}').open`),
      false,
    );
    await click(draw);
    await wait(`document.querySelector('${drawOptions}').open`);
    await click(`${drawOptions} button[title="형광펜 (B)"]`);
    await wait(`!document.querySelector('${drawOptions}').open`);
    await click('.bottom-toolbar > button[title="선택 도구 (V)"]');
    await click(draw);
    await wait(
      `document.querySelector('${draw} span').textContent === '형광펜'`,
    );
    await click('.bottom-toolbar > button[title="선택 도구 (V)"]');
    await click(`${drawOptions} > summary`);
    await wait(`document.querySelector('${drawOptions}').open`);
    assert.equal(
      await js(
        `document.querySelector('${draw}').getAttribute('aria-pressed')`,
      ),
      'false',
    );
    await click(`${drawOptions} > summary`);

    const compact = '.file-node-surface--md';
    const compactId = await js(
      `document.querySelector('${compact}').closest('.react-flow__node').dataset.id`,
    );
    const note = `[data-id=${JSON.stringify(compactId)}]`;
    const surface = `${note} ${compact}`;
    await click(note);
    await wait(
      `document.querySelector(${JSON.stringify(note)}).classList.contains('selected')`,
    );
    await js(
      `document.querySelector(${JSON.stringify(surface)}).focus({preventScroll:true})`,
    );
    const viewport = () =>
      js(`document.querySelector('.react-flow__viewport').style.transform`);
    const beforePan = await viewport();
    key('keyDown', 'Space');
    await wait(`!!document.querySelector('.app-shell--tool-hand')`);
    const [x, y] = await js(
      `(()=>{const r=document.querySelector('.canvas-shell').getBoundingClientRect();return [Math.round(r.x+r.width/2), Math.round(r.y+150)]})()`,
    );
    win.webContents.sendInputEvent({
      type: 'mouseDown',
      button: 'left',
      x,
      y,
      clickCount: 1,
    });
    win.webContents.sendInputEvent({
      type: 'mouseMove',
      x: x + 70,
      y: y + 30,
      modifiers: ['leftButtonDown'],
    });
    win.webContents.sendInputEvent({
      type: 'mouseUp',
      button: 'left',
      x: x + 70,
      y: y + 30,
      clickCount: 1,
    });
    key('keyUp', 'Space');
    await wait(`!!document.querySelector('.app-shell--tool-select')`);
    assert.notEqual(await viewport(), beforePan);
    assert.equal(
      await js(`!!document.querySelector(${JSON.stringify(surface)})`),
      true,
    );
    await js(
      `document.querySelector(${JSON.stringify(surface)}).focus({preventScroll:true})`,
    );
    key('keyDown', 'Enter');
    key('keyUp', 'Enter');
    await wait(
      `!!document.querySelector(${JSON.stringify(`${note} .markdown-body`)})`,
    );

    await click('summary[aria-label="더보기"]');
    const clickText = (label) =>
      js(
        `[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(label)}).click()`,
      );
    await clickText('설정 및 도구');
    await clickText('노드 모양');
    await wait(`!!document.querySelector('.file-node-settings')`);
    const setColor = (label, color) =>
      js(`{
      const input = [...document.querySelectorAll('.file-node-settings__colors label')].find(label=>label.textContent.trim()===${JSON.stringify(label)}).querySelector('input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(color)});
      input.dispatchEvent(new Event('input', {bubbles:true}));
    }`);
    await setColor('MD 본문 배경색', '#102030');
    await setColor('MD 본문 글씨 색', '#eebb44');
    await wait(
      `getComputedStyle(document.querySelector('.file-node-settings .file-node-summary')).color === 'rgb(238, 187, 68)'`,
    );
    await click('.file-node-settings [aria-label="MD 본문 글씨 색 초기화"]');
    await wait(
      `getComputedStyle(document.querySelector('.file-node-settings .file-node-summary')).color === 'rgb(255, 255, 255)'`,
    );
    await setColor('MD 본문 글씨 색', '#eebb44');
    await clickText('저장');
    await click('.file-node-settings [aria-label="닫기"]');
    await wait(
      `getComputedStyle(document.querySelector(${JSON.stringify(`${note} .markdown-body`)})).color === 'rgb(238, 187, 68)'`,
    );
    await click(`${note} button.canvas-file-header__title`);
    await wait(
      `getComputedStyle(document.querySelector(${JSON.stringify(`${note} .tiptap`)})).color === 'rgb(238, 187, 68)'`,
    );
    await js(
      `document.querySelector(${JSON.stringify(`${note} .tiptap`)}).focus()`,
    );
    key('keyDown', 'Space');
    await pause();
    assert.ok(await js(`!!document.querySelector('.app-shell--tool-select')`));
    key('keyUp', 'Space');
    await click(`${note} [aria-label="접기"]`);
    await wait(`!!document.querySelector(${JSON.stringify(surface)})`);

    const openShortcuts = async () => {
      await js('window.dispatchEvent(new KeyboardEvent("keydown", {key:"?"}))');
      await wait('!!document.querySelector(".shortcut-dialog")');
    };
    const changeToolKey = async (label, code, modifiers) => {
      await js(
        `{ const button = document.querySelector(${JSON.stringify(`button[aria-label="${label} 단축키 변경"]`)}); button.focus(); button.click(); }`,
      );
      key('keyDown', code, modifiers);
      key('keyUp', code, modifiers);
    };
    await openShortcuts();
    const longShortcut = 'Ctrl+Shift+E';
    const modifiers = ['control', 'shift'];
    await changeToolKey('이동', 'E', modifiers);
    await wait(
      `document.querySelector('button[aria-label="이동 단축키 변경"] kbd')?.textContent === '${longShortcut}'`,
    );
    await changeToolKey('선택', 'E', modifiers);
    await wait(
      `document.querySelector('.shortcut-reset [role=status]').textContent.includes('이미 사용 중')`,
    );
    await click('[title="단축키 안내 닫기"]');
    const changedHand = `.bottom-toolbar button[title="이동 도구 (${longShortcut})"]`;
    assert.equal(
      await js(`document.querySelector('${changedHand} kbd').textContent`),
      longShortcut,
    );
    win.setSize(980, 640);
    await pause();
    await unobscured();
    win.setSize(1280, 800);
    await js('document.querySelector(".canvas-shell").focus()');
    key('keyDown', 'E', modifiers);
    key('keyUp', 'E', modifiers);
    await wait('!!document.querySelector(".app-shell--tool-hand")');
    await click('.bottom-toolbar button[title="선택 도구 (V)"]');
    await openShortcuts();
    await clickText('도구 단축키 초기화');
    await wait(
      `document.querySelector('button[aria-label="이동 단축키 변경"] kbd')?.textContent === 'H'`,
    );
    await click('[title="단축키 안내 닫기"]');

    const openStack = async () => {
      await js(`{
        const element = document.querySelector(${JSON.stringify(surface)});
        element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2, clientX: 380, clientY: 260 }));
      }`);
      await wait('!!document.querySelector(".canvas-stack-menu")');
    };
    const noteZ = `Number(document.querySelector(${JSON.stringify(note)})?.style.zIndex)`;
    const htmlZ = `Number(document.querySelector('.file-node-surface--html').closest('.react-flow__node').style.zIndex)`;
    await openStack();
    await clickText('맨 앞으로');
    await wait(`${noteZ} > ${htmlZ}`);
    await openStack();
    await clickText('맨 뒤로');
    await wait(`${noteZ} < ${htmlZ}`);
    await js(`document.querySelector(${JSON.stringify(surface)}).focus()`);
    key('keyDown', 'Enter');
    key('keyUp', 'Enter');
    await wait(
      `!!document.querySelector(${JSON.stringify(`${note} .document-card`)})`,
    );
    assert.ok(
      await js(`${noteZ} < ${htmlZ}`),
      'opening a card keeps its manual order',
    );
    await click(`${note} [aria-label="접기"]`);
    await wait(`!!document.querySelector(${JSON.stringify(surface)})`);
    await click('.header-undo [aria-label="실행 취소"]');
    await wait(`${noteZ} > ${htmlZ}`);
    await click('.header-undo [aria-label="다시 실행"]');
    await wait(`${noteZ} < ${htmlZ}`);

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
    await wait('!!document.querySelector(".file-node-surface--md")');
    assert.equal(
      await js(
        `getComputedStyle(document.querySelector('.file-node-summary')).color`,
      ),
      'rgb(238, 187, 68)',
    );
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
      'PASS: temporary pan, file node colors, drawing tool menu, project entry, responsive canvas controls and work panels',
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
