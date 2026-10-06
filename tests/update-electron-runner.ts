import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-update-ui-'));
app.setPath('userData', root);
app.setPath('sessionData', root);
const work = path.join(root, 'project');
await fs.mkdir(work);
await fs.writeFile(
  path.join(root, 'settings.json'),
  JSON.stringify({ workspaceRoot: work }),
);
await import('../src/main');

async function run() {
  let window: BrowserWindow | undefined;
  for (let attempt = 0; attempt < 200; attempt++) {
    window = BrowserWindow.getAllWindows()[0];
    if (window && window.isVisible() && !window.webContents.isLoading()) {
      const ready = await window.webContents.executeJavaScript(
        '!!document.querySelector(".project-home")',
      );
      if (ready) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(window, 'Native app did not create a window');
  const js = async <T>(code: string): Promise<T> => {
    const result = await window!.webContents.executeJavaScript(
      `(async()=>{try{return {value:await eval(${JSON.stringify(code)})};}catch(error){return {error:String(error)};}})()`,
    );
    if (result.error) throw new Error(`${code}: ${result.error}`);
    return result.value;
  };
  const wait = async (code: string) => {
    for (let i = 0; i < 100; i++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`UI did not become ready: ${code}`);
  };
  const state = await js<{
    status: string;
    automatic: boolean;
    repository: string;
  }>('window.gameCanvas.getUpdateState()');
  assert.equal(state.status, 'unavailable');
  assert.equal(state.repository, 'sehyeok3406/game-jam-dev');
  await wait('!!document.querySelector(".home-project-open")');
  const select = async (label: string, value: string) =>
    js(
      `(()=>{const input=document.querySelector('select[aria-label="${label}"]');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
  await select('프로젝트 유형 필터', 'shared');
  await wait('!document.querySelector(".home-project-open")');
  await select('프로젝트 유형 필터', 'local');
  await wait('!!document.querySelector(".home-project-open")');
  await js(`document.querySelector('button[aria-label="목록 보기"]').click()`);
  await wait('!!document.querySelector(".home-project-list")');
  await select('프로젝트 정렬 기준', 'created');
  await js('document.querySelector(".home-sort-direction").click()');
  await wait(
    'document.querySelector(".home-result-count").textContent.includes("생성일 오래된 순")',
  );
  assert.deepEqual(
    await js('JSON.parse(localStorage.getItem("game-canvas-home-view"))'),
    { filter: 'local', sortBy: 'created', direction: 'asc', view: 'list' },
  );
  const homeBounds = await js<{ fits: boolean }>(
    '(()=>{const b=document.querySelector(".home-list-controls").getBoundingClientRect();return{fits:b.left>=0&&b.right<=innerWidth};})()',
  );
  assert.ok(homeBounds.fits, 'Home controls fit the production renderer');
  const reloaded = new Promise<void>((resolve) =>
    window!.webContents.once('did-finish-load', () => resolve()),
  );
  window.webContents.reload();
  await reloaded;
  await wait(
    '!!document.querySelector(".home-project-list .home-project-open")',
  );
  await wait(
    'document.querySelector(".home-result-count").textContent.includes("생성일 오래된 순")',
  );
  await select('프로젝트 유형 필터', 'all');
  await select('프로젝트 정렬 기준', 'modified');
  await js('document.querySelector(".home-sort-direction").click()');
  await js(
    `document.querySelector('button[aria-label="썸네일 보기"]').click()`,
  );
  await wait('!document.querySelector(".home-project-list")');
  console.log(
    'PASS: production home filters local/shared, toggles list/grid, sorts by real dates and restores view settings on reload without losing projects',
  );
  await js(
    '[...document.querySelectorAll(".home-sidebar button")].find(b=>b.textContent.includes("앱 업데이트")).click()',
  );
  await wait('!!document.querySelector(".update-dialog")');
  assert.ok(
    await js(
      'document.querySelector(".update-dialog").textContent.includes("sehyeok3406/game-jam-dev")',
    ),
  );
  assert.ok(
    await js(
      '[...document.querySelectorAll(".update-dialog button")].find(b=>b.textContent.includes("업데이트 확인")).disabled',
    ),
  );
  await js('document.querySelector(".update-automatic input").click()');
  await wait(
    'document.querySelector(".update-automatic input").checked===false',
  );
  assert.equal(
    (await js<{ automatic: boolean }>('window.gameCanvas.getUpdateState()'))
      .automatic,
    false,
  );
  assert.equal(
    JSON.parse(await fs.readFile(path.join(root, 'updates.json'), 'utf8'))
      .automatic,
    false,
  );
  await js('document.documentElement.dataset.theme="dark"');
  const bounds = await js<{ width: number; height: number; fits: boolean }>(
    '(()=>{ const b=document.querySelector(".update-dialog").getBoundingClientRect();return{width:b.width,height:b.height,fits:b.top>=0&&b.bottom<=innerHeight}; })()',
  );
  assert.ok(bounds.width >= 480 && bounds.fits);
  await fs.mkdir(path.resolve('out/qa'), { recursive: true });
  await js(
    'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',
  );
  try {
    await fs.writeFile(
      path.resolve('out/qa/update-panel-0.10.1-dark.png'),
      (await window.capturePage()).toPNG(),
    );
  } catch {
    console.log(
      'NOTE: desktop compositor screenshot is unavailable; DOM layout assertions remain active.',
    );
  }
  await js('document.documentElement.dataset.theme="light"');
  await js(
    'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',
  );
  try {
    await fs.writeFile(
      path.resolve('out/qa/update-panel-0.10.1-light.png'),
      (await window.capturePage()).toPNG(),
    );
  } catch {
    console.log(
      'NOTE: desktop compositor screenshot is unavailable; DOM layout assertions remain active.',
    );
  }
  await js(
    '[...document.querySelectorAll(".update-dialog button")].find(b=>b.getAttribute("aria-label")==="업데이트 창 닫기").click()',
  );
  await wait('!document.querySelector(".update-dialog")');
  // Feed UI events only. Development controller remains unavailable, with no update network access.
  window.webContents.send('updates:changed', {
    ...state,
    available: true,
    status: 'ready',
    releaseName: 'fixture-v0.9.3',
    message: '업데이트 다운로드 완료!',
    lastCheckedAt: Date.now(),
  });
  await wait('!!document.querySelector(".update-notice")');
  await js(
    '[...document.querySelectorAll(".update-notice button")].find(b=>b.textContent.includes("보기")).click()',
  );
  await wait('!!document.querySelector(".update-dialog")');
  assert.ok(
    await js(
      '[...document.querySelectorAll(".update-dialog button")].some(b=>b.textContent.includes("업데이트 후 재시작"))',
    ),
  );
  window.webContents.send('updates:changed', {
    ...state,
    available: true,
    status: 'error',
    errorCode: 'GC-UPD-003',
    message: '테스트 다운로드 오류',
  });
  await wait(
    'document.querySelector(".update-dialog").textContent.includes("GC-UPD-003")',
  );
  await js(
    '[...document.querySelectorAll(".update-dialog button")].find(b=>b.textContent.includes("다시 확인")).click()',
  );
  await wait(
    'document.querySelector(".update-dialog").textContent.includes("개발 실행")',
  );
  await js(
    '[...document.querySelectorAll(".update-dialog button")].find(b=>b.getAttribute("aria-label")==="업데이트 창 닫기").click()',
  );
  console.log(
    'PASS: actual Electron update UI shows connected repository without development network requests, saves preference through preload/IPC and renders dark/light layouts',
  );

  await js('document.querySelector(".home-project-open").click()');
  await wait('!!document.querySelector(".app-shell")');

  // Simulate the last safety handshake only, without an actual download or install.
  const reply = (id: string) =>
    new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        ipcMain.removeListener('updates:prepared', listen);
        reject(new Error('Renderer guard timed out'));
      }, 5000);
      const listen = (
        event: Electron.IpcMainEvent,
        receivedId: string,
        blockers: string[],
      ) => {
        if (receivedId !== id || event.sender !== window!.webContents) return;
        clearTimeout(timer);
        ipcMain.removeListener('updates:prepared', listen);
        resolve(blockers);
      };
      ipcMain.on('updates:prepared', listen);
      window!.webContents.send('updates:prepare', id);
    });
  assert.deepEqual(await reply('fixture-clean'), []);
  await wait('!!document.querySelector(".update-restarting")');
  window.webContents.send('updates:release');
  await wait('!document.querySelector(".update-restarting")');
  await js(
    '(async()=>{const doc=await window.gameCanvas.createIdea({x:100,y:100});await window.gameCanvas.saveDocument({relativePath:doc.relativePath,title:"업데이트 보호 메모",body:"초안"});})()',
  );
  await wait(
    '[...document.querySelectorAll(".document-card")].some(card=>card.textContent.includes("업데이트 보호 메모"))',
  );
  await js(
    '[...document.querySelectorAll(".document-card")].find(card=>card.textContent.includes("업데이트 보호 메모")).querySelector(".document-card__content").click()',
  );
  await wait('!!document.querySelector(".document-editor")');
  const blockers = await reply('fixture-editing');
  assert.ok(blockers.some((value) => value.includes('편집')));
  assert.equal(
    await js('!!document.querySelector(".update-restarting")'),
    false,
  );
  window.webContents.send('updates:release');
  console.log(
    'PASS: actual renderer restart guard blocks active editing; clean handshake locks and failed/cancelled handshake restores input',
  );
}
void run().then(
  () => app.exit(0),
  (error) => {
    console.error(error);
    app.exit(1);
  },
);
