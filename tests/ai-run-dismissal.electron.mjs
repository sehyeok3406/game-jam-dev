import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { app, BrowserWindow } from 'electron';
app.setPath('userData', path.resolve('out/ai-run-dismissal/profile'));
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
    for (let i = 0; i < 150; i++) {
      if (await js(code)) return;
      await sleep(50);
    }
    throw Error('AI dismissal UI timed out: ' + code);
  };
  const counts = () =>
    js(
      `({panel:document.querySelectorAll('.codex-run-panel').length,completion:document.querySelectorAll('.ai-completion-toast').length})`,
    );
  const expect = async (panel, completion) => {
    await sleep(150);
    assert.deepEqual(await counts(), { panel, completion });
    assert.equal(
      await js(
        'document.querySelector(".app-shell").classList.contains("app-shell--has-run")',
      ),
      !!panel,
    );
    assert.equal(
      await js(
        'document.querySelector(".app-shell").classList.contains("app-shell--has-completion")',
      ),
      !!completion,
    );
  };
  const closePanel = () =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.title==='실행 패널 닫기').click()`,
    );
  const reload = async () => {
    await new Promise((resolve) => {
      win.webContents.once('did-finish-load', resolve);
      win.reload();
    });
    await wait(
      `!!document.querySelector('[title="프로젝트 홈으로 돌아가기"]')`,
    );
    await sleep(200);
  };
  let code = 0;
  try {
    await win.loadURL(process.env.QA_URL);
    await js('localStorage.clear();sessionStorage.clear()');
    await reload();
    await js('qaAi.run("run-1")');
    await expect(1, 1);
    await closePanel();
    await expect(0, 0);
    await js('qaAi.replay();qaAi.ipc()');
    await expect(0, 0);
    await reload();
    await expect(0, 0);
    await js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.title==='프로젝트 홈으로 돌아가기').click()`,
    );
    await wait('!!document.querySelector(".home-project-open")');
    await js('document.querySelector(".home-project-open").click()');
    await wait('!!document.querySelector(".document-card")');
    await expect(0, 0);
    await js('qaAi.run("run-2","running")');
    await expect(1, 0);
    await js('qaAi.run("run-2","completed");qaAi.ipc()');
    await expect(1, 1);
    await closePanel();
    await js(
      'qaAi.run("run-2","running");qaAi.ipc();qaAi.run("run-2","completed")',
    );
    await expect(0, 0);
    await js('qaAi.run("run-3")');
    await expect(1, 1);
    await js('document.querySelector(".ai-completion-toast__close").click()');
    await expect(1, 0);
    await js('qaAi.replay();qaAi.ipc()');
    await expect(1, 0);
    await reload();
    await expect(1, 0);
    await js('qaAi.project()');
    await expect(0, 0);
    await js('qaAi.project("qa-project-a");qaAi.run("run-3")');
    await expect(1, 0);
    await js('qaAi.project("qa-project-b")');
    await expect(1, 1);
    await closePanel();
    await expect(0, 0);
    await js('qaAi.project("qa-project-a")');
    await expect(1, 0);
    await js('qaAi.run("run-4","failed")');
    await expect(1, 1);
    await closePanel();
    await reload();
    await expect(0, 0);
    await js('qaAi.run("run-storage")');
    await expect(1, 1);
    await js(
      'window.qaSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error("storage disabled")};void 0',
    );
    await closePanel();
    await expect(0, 0);
    await js(
      'Storage.prototype.setItem=window.qaSetItem;qaAi.replay();qaAi.ipc();void 0',
    );
    await expect(0, 0);
    await fs.mkdir('out/ai-run-dismissal', { recursive: true });
    await fs.writeFile(
      'out/ai-run-dismissal/verification.json',
      JSON.stringify(
        {
          sharedReplay: true,
          ipcReplay: true,
          reload: true,
          homeReentry: true,
          lateProgressReplay: true,
          newRun: true,
          completionOnlyClose: true,
          identityChange: true,
          projectIsolation: true,
          failedRun: true,
          storageFailureSession: true,
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS: shared/IPC replay, restart, home reentry, running/failed/new tasks, project isolation, identity changes and storage failure',
    );
  } catch (error) {
    code = 1;
    console.error(error);
  } finally {
    win.destroy();
    app.exit(code);
  }
}
run().catch((error) => {
  console.error(error);
  app.exit(1);
});
