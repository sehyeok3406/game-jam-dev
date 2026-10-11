import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow } from 'electron';

const output = path.resolve('out/html-preview-ui');
app.setPath('userData', path.join(output, 'profile'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function run() {
  await fs.mkdir(output, { recursive: true });
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 850,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      offscreen: true,
      backgroundThrottling: false,
    },
  });
  const watchdog = setTimeout(() => app.exit(1), 60000);
  const results = [];
  try {
    for (const theme of ['light', 'dark'])
      for (const state of ['default', 'warning', 'collapsed']) {
        const url = pathToFileURL(process.env.QA_RENDERER);
        url.searchParams.set(
          'uiDebugPreview',
          JSON.stringify({ scope: 'project', id: 'preview', state, theme }),
        );
        const host = path.join(output, 'host.html');
        await fs.writeFile(
          host,
          `<!doctype html><html><body style="margin:0"><iframe allowfullscreen style="border:0;width:100vw;height:100vh;display:block" src="${url.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></iframe></body></html>`,
        );
        await win.loadFile(host);
        let frame;
        for (let n = 0; n < 150; n++) {
          frame = win.webContents.mainFrame.frames[0];
          if (
            frame &&
            (await frame
              .executeJavaScript('!!document.querySelector(".preview-card")')
              .catch(() => false))
          )
            break;
          await sleep(70);
        }
        assert.ok(frame);
        const js = (code) => frame.executeJavaScript(code, true);
        assert.ok(await js('!!document.querySelector(".preview-card")'));
        if (state === 'collapsed') {
          assert.equal(
            await js('document.querySelector(".preview-card").clientHeight'),
            36,
          );
          assert.equal(
            await js(
              'getComputedStyle(document.querySelector(".preview-card__play-area")).display',
            ),
            'none',
          );
          assert.equal(
            await js(
              '!!document.querySelector(".preview-card").querySelector(".preview-import-warning")',
            ),
            false,
          );
          results.push({ theme, state });
          continue;
        }
        for (const [width, height] of [
          [420, 300],
          [720, 520],
          [1080, 720],
        ]) {
          await js(
            `Object.assign(document.querySelector('.preview-card').style,{width:'${width}px',height:'${height}px'})`,
          );
          await sleep(130);
          const layout = await js(
            `(()=>{const card=document.querySelector('.preview-card');const header=card.querySelector('header');const warning=card.querySelector('.preview-import-warning');const play=card.querySelector('.preview-card__play-area');const iframe=play.querySelector('iframe');return {card:card.clientHeight,header:header.offsetHeight,warning:warning?.offsetHeight??0,game:play.offsetHeight,iframe:iframe.clientHeight,rows:getComputedStyle(card).gridTemplateRows.split(' ').length,warningClass:card.classList.contains('preview-card--warning')};})()`,
          );
          assert.equal(layout.rows, state === 'warning' ? 3 : 2);
          assert.equal(layout.warningClass, state === 'warning');
          assert.equal(layout.header, 38);
          assert.ok(layout.warning < 75, JSON.stringify(layout));
          assert.equal(
            layout.game,
            layout.card - layout.header - layout.warning,
          );
          assert.equal(layout.iframe, layout.game);
          assert.ok(layout.game > height * 0.6);
          results.push({ theme, state, width, height, ...layout });
          await fs.writeFile(
            path.join(output, `${theme}-${state}-${width}.png`),
            (await win.webContents.capturePage()).toPNG(),
          );
        }
        if (state === 'warning') {
          await js(
            'document.querySelector(\'[title="HTML 창 최소화"]\').click()',
          );
          await sleep(150);
          assert.equal(
            await js(
              '!!document.querySelector(".preview-card").querySelector(".preview-import-warning")',
            ),
            false,
          );
          assert.equal(
            await js(
              'document.querySelector(".preview-card").classList.contains("preview-card--warning")',
            ),
            false,
          );
          await js(
            'document.querySelector(\'[title="HTML 창 펼치기"]\').click()',
          );
          await sleep(150);
          assert.equal(
            await js(
              '!!document.querySelector(".preview-card").querySelector(".preview-import-warning")',
            ),
            true,
          );
          await js(
            "document.querySelector('.preview-card').requestFullscreen()",
          );
          await sleep(220);
          assert.equal(await js('!!document.fullscreenElement'), true);
          const layout = await js(
            "(()=>{const c=document.fullscreenElement;const w=c.querySelector('.preview-import-warning');const p=c.querySelector('.preview-card__play-area');return {card:c.clientHeight,warning:w.offsetHeight,game:p.offsetHeight,rows:getComputedStyle(c).gridTemplateRows.split(' ').length};})()",
          );
          assert.equal(layout.rows, 3);
          assert.equal(layout.game, layout.card - 38 - layout.warning);
          results.push({ theme, state: 'fullscreen-warning', ...layout });
          await fs.writeFile(
            path.join(output, `${theme}-fullscreen-warning.png`),
            (await win.webContents.capturePage()).toPNG(),
          );
          await js('document.exitFullscreen()');
        }
      }
    await fs.writeFile(
      path.join(output, 'result.json'),
      JSON.stringify(results, null, 2),
    );
    console.log(
      'PASS: production preview, light/dark, warnings/no warnings, 3 card sizes, collapse/expand, fullscreen; game fills remaining height.',
    );
  } finally {
    clearTimeout(watchdog);
    win.destroy();
    app.quit();
  }
}
run().catch((error) => {
  console.error(error);
  app.exit(1);
});
