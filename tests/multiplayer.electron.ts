import { app, BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { registerMultiplayerWindows } from '../src/multiplayer/window-manager';
import { validateHtml } from '../src/html-validation';
import { COOP_REFERENCE_HTML } from '../src/multiplayer/reference-game';

const auth = JSON.parse(process.env.GAMEJAM_QA_AUTH!);
delete process.env.GAMEJAM_QA_AUTH;
const root = process.env.GAMEJAM_QA_ROOT!;
const role = process.env.GAMEJAM_QA_ROLE!;
app.setPath('userData', path.join(root, role + '-profile'));
app.on('window-all-closed', () => {});
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(
  condition: () => Promise<unknown>,
  label: string,
  attempts = 600,
) {
  for (let n = 0; n < attempts; n++) {
    if (await condition()) return;
    await delay(50);
  }
  throw Error('Timeout: ' + label);
}
async function run() {
  await app.whenReady();
  const watchdog = setTimeout(() => app.exit(1), 110000);
  let manager: ReturnType<typeof registerMultiplayerWindows>;
  try {
    if (role === 'host')
      await validateHtml(
        COOP_REFERENCE_HTML.replace('"maxPlayers":2', '"maxPlayers":4'),
        'reference-four.html',
      );
    manager = registerMultiplayerWindows({
      preload: path.join(root, 'multiplayer-player-preload.cjs'),
      credentials: () => auth.credentials,
      memberId: () => auth.memberId,
      isMainSender: () => false,
      currentHtml: () => undefined,
    });
    await manager.open(auth.roomId);
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())!;
    assert.ok(win);
    win.show();
    const js = (code: string) => win.webContents.executeJavaScript(code, true);
    await until(
      () => js('!document.querySelector("#ready").disabled'),
      'ready button enabled',
    );
    await js('document.querySelector("#ready").click()');
    if (role === 'host') {
      await until(
        () => js('!document.querySelector("#start").disabled'),
        'all participants ready',
      );
      await js('document.querySelector("#start").click()');
    }
    await until(
      () =>
        js(
          'document.querySelector("#status").textContent.includes("함께 플레이 중")',
        ),
      'running',
    );
    let frame = win.webContents.mainFrame.frames.find(
      (frame) => frame.url === 'about:srcdoc',
    )!;
    assert.ok(frame, 'opaque game frame exists');
    await frame.executeJavaScript(
      `dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}))`,
    );
    await delay(650);
    await frame.executeJavaScript(
      `dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowRight'}))`,
    );
    await until(
      () =>
        frame.executeJavaScript(
          'document.querySelector("#score").textContent.includes("1/3")',
        ),
      'shared pickup once',
    );
    await fs.writeFile(
      path.join(root, role + '-running.json'),
      JSON.stringify({
        score: await frame.executeJavaScript(
          'document.querySelector("#score").textContent',
        ),
        visible: win.isVisible(),
        sandbox: win.webContents.getLastWebPreferences().sandbox,
      }),
    );
    if (role === 'guest') {
      win.webContents.reload();
      await until(
        () =>
          js(
            '!!document.querySelector("#status")&&document.querySelector("#status").textContent.includes("함께 플레이 중")',
          ),
        'guest runtime restore',
      );
      await delay(250);
      frame = win.webContents.mainFrame.frames.find(
        (frame) => frame.url === 'about:srcdoc',
      )!;
      await until(
        () =>
          frame.executeJavaScript(
            'document.querySelector("#score").textContent.includes("1/3")',
          ),
        'snapshot retained after reload',
      );
      const before = await frame.executeJavaScript(
        'document.querySelector("canvas").toDataURL()',
      );
      await frame.executeJavaScript(
        `dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown'}))`,
      );
      await delay(400);
      await frame.executeJavaScript(
        `dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowDown'}))`,
      );
      await delay(150);
      const after = await frame.executeJavaScript(
        'document.querySelector("canvas").toDataURL()',
      );
      assert.notEqual(before, after, 'restored client can send movement input');
      await fs.writeFile(
        path.join(root, 'guest-runtime-restore.json'),
        JSON.stringify({ passed: true }),
      );
    }
    if (role === 'host') {
      win.minimize();
      await delay(60000);
      win.restore();
      assert.ok(
        (await js('document.querySelector("#status").textContent')).includes(
          '함께 플레이 중',
        ),
        'host simulation survives minimizing',
      );
      await win.webContents
        .capturePage()
        .then((image) =>
          fs.writeFile(path.join(root, 'play-window.png'), image.toPNG()),
        );
      await fs.writeFile(
        path.join(root, 'host-minimize.json'),
        JSON.stringify({
          seconds: 60,
          status: await js('document.querySelector("#status").textContent'),
        }),
      );
    }
    await fs.writeFile(
      path.join(root, role + '-done.json'),
      JSON.stringify({ passed: true }),
    );
    await until(
      async () =>
        !!(await fs.stat(path.join(root, 'finish')).catch(() => null)),
      'coordinator finish',
      1800,
    );
    manager.close();
    clearTimeout(watchdog);
    app.exit(0);
  } catch (error) {
    await fs.writeFile(
      path.join(root, role + '-failure.txt'),
      String((error as Error).stack),
    );
    clearTimeout(watchdog);
    app.exit(1);
  }
}
void run().catch(async (error) => {
  await fs.writeFile(
    path.join(root, role + '-failure.txt'),
    String(error.stack),
  );
  app.exit(1);
});
