import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { app, BrowserWindow } from 'electron';
import { installPreviewPermissions } from '../src/preview-permissions.ts';

const dir = 'out/canvas-stage6',
  baseline = process.env.CAMERA_VARIANT === 'stage5';
app.setPath('userData', path.resolve(dir, 'profiles', randomUUID()));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rows = [];
let win, server;
const watchdog = setTimeout(() => {
  console.error('Preview playback UI timeout');
  app.exit(1);
}, 180000);
async function run() {
  await app.whenReady();
  server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  let connections = 0;
  server.on('connection', (socket) => {
    connections++;
    socket.on('message', (value) => socket.send(value));
  });
  win = new BrowserWindow({
    show: true,
    width: 1440,
    height: 1000,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  installPreviewPermissions(win);
  win.webContents.debugger.attach('1.3');
  const key = async (key, code, virtual) => {
    for (const type of ['keyDown', 'keyUp'])
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
        type,
        key,
        code,
        windowsVirtualKeyCode: virtual,
        nativeVirtualKeyCode: virtual,
      });
  };
  const errors = [];
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error' && !event.message.startsWith('ResizeObserver'))
      errors.push(event.message);
  });
  win.webContents.on('will-prevent-unload', (event) => event.preventDefault());
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const wait = async (code) => {
    for (let i = 0; i < 220; i++) {
      if (await js(code)) return;
      await pause(60);
    }
    console.error(
      'Playback diagnostic',
      await js(
        '({frames:document.querySelectorAll(".preview-card iframe").length,observers:window.__previewObservers,counts:window.__perfCounts,fullscreen:!!document.fullscreenElement,reports:window.__previewReports?.length})',
      ),
      errors,
    );
    throw Error('Timed out: ' + code);
  };
  await win.loadURL(
    process.env.QA_URL + '?kind=html-active&n=30&preview-lifecycle&updates',
  );
  await wait('!!document.querySelector(".home-project-open")');
  await js('document.querySelector(".home-project-open").click()');
  await wait(
    'window.__perfFlow?.getNodes().length===30 && document.querySelectorAll(".preview-card iframe").length===30',
  );
  await wait('document.querySelector(".status-toast")?.hidden===true');
  await js('__perfFlow.setViewport({x:0,y:0,zoom:1})');
  await pause(350);
  const frames = win.webContents.mainFrame.frames;
  assert.equal(frames.length, 30);
  const states = [];
  for (const frame of frames)
    states.push(
      await frame.executeJavaScript(`(()=>{
    const match=document.querySelector('script[data-game-canvas-preview-controls]').textContent.match(/id:"([^"]+)"/);
    window.__qaId=match[1];window.__qaGame={score:42,boot:Math.random(),keys:0};
    document.addEventListener('keydown',event=>{if(event.key.toLowerCase()==='w'){__qaGame.keys++;__qaGame.trusted=event.isTrusted;}});
    return {id:__qaId,boot:__qaGame.boot};
  })()`),
    );
  await js(
    `window.__qaFrames=[...document.querySelectorAll('.preview-card iframe')];window.__qaWindows=__qaFrames.map(f=>f.contentWindow);window.__qaHtml=__qaFrames.map(f=>f.srcdoc);true;`,
  );
  const observers = await js('window.__previewObservers??0');
  assert.equal(observers, baseline ? 30 : 0);
  rows.push({ check: 'ordinary preview resize observers', observers });
  await js(
    'window.__previewMessageCallbacks=0;window.__previewReports=[];true;',
  );
  await Promise.all(
    frames.map((frame) =>
      frame.executeJavaScript(
        `for(let i=0;i<10;i++)parent.postMessage({type:'gamejam:diagnostic',id:__qaId,diagnostic:{sequence:i}},'*');true;`,
      ),
    ),
  );
  await wait('__previewReports.length===300');
  const routing = await js(
    '({callbacks:__previewMessageCallbacks,reports:__previewReports.length,paths:new Set(__previewReports.map(r=>r.path)).size})',
  );
  assert.equal(routing.paths, 30);
  assert.equal(routing.callbacks, baseline ? 18000 : 300);
  rows.push({
    check: '300 real sandbox-frame diagnostic messages',
    ...routing,
  });
  const firstId = await js(`__qaFrames[0].srcdoc.match(/id:"([^"]+)"/)[1]`);
  const first = frames[states.findIndex((s) => s.id === firstId)];
  const firstState = states.find((s) => s.id === firstId);
  await first.executeJavaScript(
    `parent.postMessage({type:'gamejam:diagnostic',id:'wrong-owner',diagnostic:{}},'*');true;`,
  );
  await pause(80);
  assert.equal(await js('__previewReports.length'), 300);
  await first.executeJavaScript(
    `window.__qaAck=0;window.__qaSocket=new WebSocket('ws://127.0.0.1:${server.address().port}');__qaSocket.addEventListener('open',()=>{window.__qaTimer=setInterval(()=>__qaSocket.send('heartbeat'),100)});__qaSocket.addEventListener('message',()=>__qaAck++);true;`,
  );
  for (
    let i = 0;
    i < 120 && (await first.executeJavaScript('__qaAck')) < 2;
    i++
  )
    await pause(50);
  assert.ok(await first.executeJavaScript('__qaAck>=2'));
  await js(
    'window.__perfCounts={};qaNodeUpdates.body("갱신한 참고 설명");true;',
  );
  await wait('window.__qaLinkBodies?.includes("갱신한 참고 설명")');
  await pause(160);
  const renders = await js('__perfCounts.preview??0');
  assert.equal(renders, baseline ? 30 : 0);
  rows.push({
    check: 'unrelated document body update',
    previewCardRenders: renders,
  });
  const ackBefore = await first.executeJavaScript('__qaAck');
  for (let i = 0; i < 30; i++) {
    const x = i % 3 === 0 ? -60000 : i % 3 === 1 ? 900 : -900;
    await js(
      `__perfFlow.setViewport({x:${x},y:${i % 2 ? -500 : 150},zoom:${i % 2 ? 0.2 : 1.2}})`,
    );
    await pause(20);
  }
  await pause(1100);
  assert.ok(
    await first.executeJavaScript(
      `__qaAck>${ackBefore}&&__qaSocket.readyState===1`,
    ),
  );
  assert.equal(
    connections,
    1,
    'camera movement does not reconnect the live socket',
  );
  assert.ok(
    await js(
      `__qaFrames.every((f,i)=>f===document.querySelectorAll('.preview-card iframe')[i]&&f.contentWindow===__qaWindows[i]&&f.srcdoc===__qaHtml[i])`,
    ),
  );
  for (let i = 0; i < frames.length; i++)
    assert.deepEqual(
      await frames[i].executeJavaScript(
        '({id:__qaId,boot:__qaGame.boot,score:__qaGame.score})',
      ),
      { ...states[i], score: 42 },
    );
  rows.push({
    check: 'rapid camera reversals preserve all 30 games and a live WebSocket',
    connections,
  });
  await js('__perfFlow.setViewport({x:0,y:0,zoom:1})');
  await pause(350);
  const card = 'document.querySelector(".preview-card")';
  const selectPreset = async (value) => {
    await js(
      `{const input=${card}.querySelector('[aria-label="HTML 화면 비율"]');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('change',{bubbles:true}));}`,
    );
    await wait(
      `__perfFlow.getNodes().find(n=>n.data.kind==='preview').data.windowState.presetId===${JSON.stringify(value)}`,
    );
    await pause(120);
  };
  const enter = async () => {
    await js(`${card}.querySelector('[title="HTML 전체화면 플레이"]').click()`);
    await wait('!!document.fullscreenElement');
    win.focus();
    await pause(180);
  };
  await selectPreset('pc-720');
  await enter();
  await wait(`(window.__previewObservers??0)===${baseline ? 30 : 1}`);
  const size = await first.executeJavaScript(
    '({width:innerWidth,height:innerHeight})',
  );
  assert.deepEqual(size, { width: 1280, height: 720 });
  const fit = await js(
    `(()=>{const a=${card}.querySelector('.preview-card__play-area'),v=${card}.querySelector('.preview-card__viewport');return {scale:new DOMMatrixReadOnly(getComputedStyle(v).transform).a,expected:Math.min(a.clientWidth/1280,a.clientHeight/720)}})()`,
  );
  assert.ok(Math.abs(fit.scale - fit.expected) < 0.001);
  await js('__qaFrames[0].focus()');
  // Native fullscreen can briefly move focus back to the top widget. Click
  // inside the actual game surface before sending keyboard input.
  await pause(500);
  win.focus();
  const gamePoint = await js(
    `(()=>{const r=__qaFrames[0].getBoundingClientRect();return {x:Math.round(r.x+r.width/3),y:Math.round(r.y+r.height/3)}})()`,
  );
  win.webContents.sendInputEvent({
    type: 'mouseDown',
    ...gamePoint,
    button: 'left',
    clickCount: 1,
  });
  win.webContents.sendInputEvent({
    type: 'mouseUp',
    ...gamePoint,
    button: 'left',
    clickCount: 1,
  });
  await pause(120);
  await first.executeJavaScript(
    "window.focus();document.querySelector('canvas').tabIndex=0;document.querySelector('canvas').focus();true;",
    true,
  );
  await key('w', 'KeyW', 87);
  for (
    let i = 0;
    i < 30 && !(await first.executeJavaScript('__qaGame.keys>0'));
    i++
  )
    await pause(60);
  console.log('Fullscreen keyboard target', {
    gamePoint,
    mainFocused: win.isFocused(),
    gameFocused: await first.executeJavaScript('document.hasFocus()'),
    keys: await first.executeJavaScript('__qaGame.keys'),
  });
  assert.ok(
    await first.executeJavaScript('__qaGame.keys>0'),
    'native keyboard reaches the fullscreen game',
  );
  assert.ok(await first.executeJavaScript('__qaGame.trusted'));
  assert.equal(
    await first.executeJavaScript(
      'document.querySelector("canvas").requestPointerLock().then(()=>true,()=>false)',
      true,
    ),
    true,
  );
  await first.executeJavaScript(
    `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true;`,
  );
  await wait('!document.fullscreenElement');
  await pause(100);
  assert.equal(
    await first.executeJavaScript('!!document.pointerLockElement'),
    false,
  );
  assert.equal(await first.executeJavaScript('__qaGame.boot'), firstState.boot);
  rows.push({
    check: 'fixed fullscreen, keyboard, pointer lock and frame Escape',
    ...size,
    ...fit,
  });
  await selectPreset('free');
  await enter();
  assert.equal(await js('window.__previewObservers??0'), baseline ? 30 : 0);
  await key('Escape', 'Escape', 27);
  await wait('!document.fullscreenElement');
  await js(`${card}.querySelector('[title="HTML 창 최소화"]').click()`);
  await wait(`${card}.classList.contains('preview-card--collapsed')`);
  assert.ok(
    await js('__qaFrames[0]===document.querySelector(".preview-card iframe")'),
  );
  await js(`${card}.querySelector('[title="HTML 창 펼치기"]').click()`);
  await wait(`!${card}.classList.contains('preview-card--collapsed')`);
  await wait(`${card}.getBoundingClientRect().height>300`);
  assert.equal(await first.executeJavaScript('__qaGame.boot'), firstState.boot);
  rows.push({
    check:
      'free fullscreen, native Escape and explicit collapse preserve the game',
  });
  await fs.writeFile(
    path.join(dir, `${baseline ? 'stage5' : 'stage6'}-fullscreen-return.png`),
    (await win.webContents.capturePage()).toPNG(),
  );
  await js(`${card}.querySelector('[title="HTML 다시 실행"]').click()`);
  await wait('document.querySelector(".preview-card iframe")!==__qaFrames[0]');
  assert.ok(
    await js(
      '__qaFrames.slice(1).every((f,i)=>f===document.querySelectorAll(".preview-card iframe")[i+1])',
    ),
  );
  rows.push({ check: 'explicit restart replaces only its own game' });
  await js('__perfFlow.setNodes([]);true;');
  await wait('document.querySelectorAll(".preview-card iframe").length===0');
  assert.equal(await js('window.__previewObservers??0'), 0);
  const oldCallbacks = await js('window.__previewMessageCallbacks??0');
  await js(
    `window.dispatchEvent(new MessageEvent('message',{source:__qaWindows[0],data:{type:'gamejam:diagnostic',id:${JSON.stringify(firstId)},diagnostic:{late:true}}}));true;`,
  );
  assert.equal(
    await js('window.__previewMessageCallbacks??0'),
    oldCallbacks,
    'leaving the canvas removes old message handlers',
  );
  rows.push({
    check: 'unmount releases app observers and event registrations',
  });
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(dir, `${baseline ? 'stage5' : 'stage6'}-playback-ui.json`),
    JSON.stringify(
      { complete: true, variant: process.env.CAMERA_VARIANT, rows, errors },
      null,
      2,
    ),
  );
  console.log('PASS preview playback', JSON.stringify(rows));
}
run()
  .then(() => {
    clearTimeout(watchdog);
    win?.destroy();
    server?.clients.forEach((s) => s.terminate());
    server?.close();
    app.exit(0);
  })
  .catch(async (error) => {
    clearTimeout(watchdog);
    console.error(error);
    if (win && !win.isDestroyed()) {
      await fs.writeFile(
        path.join(dir, 'playback-failure.png'),
        (await win.webContents.capturePage()).toPNG(),
      );
      win.destroy();
    }
    server?.clients.forEach((s) => s.terminate());
    server?.close();
    app.exit(1);
  });
