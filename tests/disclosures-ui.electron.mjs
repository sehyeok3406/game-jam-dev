import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
app.setPath('userData', path.resolve('out/disclosures-ui/profile'));
async function run() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const wait = async (code) => {
    for (let n = 0; n < 200; n++) {
      if (await js(code)) return;
      await pause(70);
    }
    throw Error('Timed out: ' + code);
  };
  let exitCode = 0;
  try {
    await fs.mkdir('out/disclosures-ui', { recursive: true });
    await win.loadURL(process.env.QA_URL);
    await wait('!!window.uiDebugQa');
    await js(
      `(()=>{const f=document.createElement('iframe');f.id='disclosure-audit';f.style='position:fixed;inset:0;width:100%;height:100%;border:0;z-index:99999;background:white';document.body.append(f);window.addEventListener('message',e=>{if(e.source===f.contentWindow&&e.data.type==='ui-debug:ready')window.disclosureReady=e.data;});})()`,
    );
    const results = [];
    for (const theme of ['light', 'dark']) {
      for (const [id, state] of [
        ['game-ui-inspector', 'single'],
        ['ai-request', 'both'],
        ['ai-request', 'library'],
        ['ai-request', 'review'],
        ['ai-details', 'default'],
        ['collaboration', 'recovery'],
        ['document', 'reference'],
        ['preview', 'independent'],
        ['drawing-tools', 'default'],
      ]) {
        const url = new URL('/index.html', process.env.QA_URL);
        url.searchParams.set(
          'uiDebugPreview',
          JSON.stringify({ id, state, scope: 'project', theme }),
        );
        await js(
          `window.disclosureReady=null;document.querySelector('#disclosure-audit').src=${JSON.stringify(url.href)}`,
        );
        await wait('!!window.disclosureReady');
        assert.equal(await js('disclosureReady.found'), true, id + '/' + state);
        const audit = await js(`(()=>{
        const w=document.querySelector('#disclosure-audit').contentWindow,d=w.document;
        const menus='.canvas-main-menu,.canvas-zoom-menu,.canvas-tool-more,.canvas-drawing-group,.drawing-tool-menu,.selection-arrange-menu';
        const entries=[];
        const details=[...d.querySelectorAll('details')];
        const original = new Map(details.map(e=>[e,e.open]));
        details.filter(e=>!e.matches(menus)).forEach(e=>{e.open=true;});
        for(const e of details){
          const s=e.querySelector(':scope > summary');if(!s||e.matches(menus)||!s.getClientRects().length)continue;
          const open=e.open;e.open=false;
          const closed=w.getComputedStyle(s,'::before');const before={content:closed.content,transform:closed.transform,width:parseFloat(closed.width),color:closed.color};
          e.open=true;const expanded=w.getComputedStyle(s,'::before').transform;
          entries.push({title:s.textContent.trim(),...before,expanded,marker:w.getComputedStyle(s,'::marker').content,padding:parseFloat(w.getComputedStyle(s).paddingInlineStart)});
          e.open=open;
        }
        details.forEach(e=>{e.open=original.get(e);});
        return entries;
      })()`);
        for (const item of audit) {
          assert.equal(item.content, '""', id + ': ' + JSON.stringify(item));
          assert.ok(
            item.width >= 6 && item.padding >= 20,
            id + ': ' + JSON.stringify(item),
          );
          assert.notEqual(
            item.transform,
            item.expanded,
            id + ': ' + JSON.stringify(item),
          );
        }
        results.push({ theme, id, state, count: audit.length });
        if (id === 'game-ui-inspector') {
          await js(
            `(()=>{const d=document.querySelector('#disclosure-audit').contentDocument;d.querySelector('.game-ui-appearance').open=false;d.querySelector('.game-ui-appearance > summary').click();})()`,
          );
          await wait(
            `document.querySelector('#disclosure-audit').contentDocument.querySelector('.game-ui-appearance').open`,
          );
          await pause(100);
          await fs.writeFile(
            'out/disclosures-ui/game-ui-' + theme + '.png',
            (await win.webContents.capturePage()).toPNG(),
          );
        }
      }
    }
    assert.ok(
      results.reduce((n, r) => n + r.count, 0) >= 20,
      'Audit must cover actual accordion headings',
    );
    // Native keyboard activation in the main frame (offscreen Electron does
    // not reliably route synthesized input into the preview iframe).
    await win.loadURL(
      new URL('/tests/self-host.fixture.html', process.env.QA_URL).href,
    );
    await wait('!!document.querySelector(".home-entry-actions")');
    win.webContents.focus();
    await js(
      `(()=>{const e=document.createElement('details');e.id='keyboard-disclosure';e.innerHTML='<summary>키보드 접기·펼치기</summary><p>내용</p>';e.style='position:fixed;inset:100px auto auto 30px;z-index:999999;background:white;color:black';document.body.append(e);e.querySelector('summary').focus();})()`,
    );
    assert.equal(
      await js('document.activeElement.parentElement.id'),
      'keyboard-disclosure',
    );
    await pause(100);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await wait(`document.querySelector('#keyboard-disclosure').open`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    win.webContents.sendInputEvent({ type: 'char', keyCode: ' ' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await wait(`!document.querySelector('#keyboard-disclosure').open`);
    await js('document.querySelector("#keyboard-disclosure").remove()');
    await js(
      `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='협업 서버 열기').click()`,
    );
    await wait('!!document.querySelector(".self-host-dialog[open]")');
    const existing = await js(
      `Array.from(document.querySelectorAll('.self-host-help summary')).map(s=>{const e=s.parentElement,open=e.open;e.open=false;const closed=getComputedStyle(s.querySelector('.self-host-disclosure')).transform;e.open=true;const expanded=getComputedStyle(s.querySelector('.self-host-disclosure')).transform;e.open=open;return {marker:getComputedStyle(s,'::before').content,closed,expanded};})`,
    );
    assert.ok(existing.length >= 2);
    existing.forEach((e) => {
      assert.ok(e.marker === 'none' || e.marker === 'normal');
      assert.notEqual(e.closed, e.expanded);
    });
    await pause(100);
    await fs.writeFile(
      'out/disclosures-ui/self-host.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    await fs.writeFile(
      'out/disclosures-ui/audit.json',
      JSON.stringify(results, null, 2),
    );
    console.log(
      'PASS: accordion indicators and rotation across production UI previews, light/dark, native Enter/Space and existing self-host chevrons',
      JSON.stringify(results),
    );
  } catch (e) {
    exitCode = 1;
    console.error(e);
    await fs.writeFile(
      'out/disclosures-ui/failure.png',
      (await win.webContents.capturePage()).toPNG(),
    );
  } finally {
    win.destroy();
    app.exit(exitCode);
  }
}
void run().catch((error) => {
  console.error(error);
  app.exit(1);
});
