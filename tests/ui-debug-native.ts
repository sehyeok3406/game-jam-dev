import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { app, BrowserWindow, ipcMain } from 'electron';
import { createUiPreviewApi } from '../src/ui/debug/uiDebugFixtures';
import { installUiDebugShortcut } from '../src/ui-debug-shortcut';

app.setPath('userData', path.resolve('out/ui-debug-native/profile'));
async function run() {
  await app.whenReady();
  const api = createUiPreviewApi(
    { scope: 'home', id: 'home', state: 'default', theme: 'dark' },
    () => {},
  );
  const calls: string[] = [];
  let copied = '';
  const reads: Record<string, (...args: any[]) => unknown> = {
    'workspace:get': api.getWorkspace,
    'projects:list': api.listProjects,
    'projects:folders': api.listProjectFolders,
    'projects:open': api.getWorkspace,
    'canvas:changes': api.getCanvasChanges,
    'canvases:list': api.getCanvasSheets,
    'documents:list': api.listDocuments,
    'documents:get': api.getDocument,
    'sections:list': api.listSections,
    'preview:list': api.listPreviews,
    'preview:window': api.getPreviewWindow,
    'edit:state': api.getUndoState,
    'collaboration:get': api.getCollaboration,
    'collaboration:test-users': api.getTestUsers,
    'updates:state': api.getUpdateState,
    'codex:active': api.getActiveRun,
    'ai:status': api.getAiStatus,
    'drafts:get': api.getEditorDraft,
    'history:list': api.listHistory,
    'files:authorship': api.getFileAuthorship,
    'collaboration:lock': async () => {},
    'collaboration:unlock': async () => {},
    'clipboard:copy': async (text: string) => {
      copied = text;
    },
  };
  for (const [channel, method] of Object.entries(reads))
    ipcMain.handle(channel, (_event, ...args) => {
      calls.push(channel);
      return method(...args);
    });
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 1050,
    webPreferences: {
      preload: path.resolve('out/ui-debug-native/preload.cjs'),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      offscreen: true,
      backgroundThrottling: false,
    },
  });
  installUiDebugShortcut(win.webContents);
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const wait = async (code: string) => {
    for (let i = 0; i < 180; i++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    throw Error('Native UI timed out: ' + code);
  };
  const f12 = () => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F12' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F12' });
  };
  try {
    await win.loadFile(path.resolve('out/ui-debug-build/index.html'));
    await wait('!!document.querySelector(".home-project-open")');
    assert.equal(
      await js('typeof window.gameCanvas.onUiDebugToggle'),
      'function',
    );
    const before = calls.length;
    f12();
    await wait('!!document.querySelector(".ui-debug-console[open]")');
    await wait(
      '!!document.querySelector(".ui-debug-stage iframe")?.contentDocument?.querySelector(".ui-preview-selected")',
    );
    assert.equal(
      calls.length,
      before,
      'preload IPC must not be available to previews',
    );
    await js(
      'document.querySelector("[data-debug-entry=collaboration] button").click()',
    );
    await wait(
      '!!document.querySelector(".ui-debug-stage iframe")?.contentDocument?.querySelector(".collaboration-dialog")',
    );
    assert.equal(calls.length, before);
    await js('document.querySelector(".ui-debug-stage iframe").focus()');
    f12();
    await wait('!document.querySelector(".ui-debug-console")');
    assert(!win.webContents.isDevToolsOpened());
    await js('document.querySelector(".home-project-open").click()');
    await wait('!!document.querySelector(".document-card")');
    f12();
    await wait('!!document.querySelector(".ui-debug-console[open]")');
    assert.equal(
      await js(
        'document.querySelectorAll("[data-debug-entry=home-create]").length',
      ),
      0,
    );
    const projectCalls = calls.length;
    await js(
      'document.querySelector("[data-debug-entry=delete] button").click()',
    );
    await wait(
      '!!document.querySelector(".ui-debug-stage iframe")?.contentDocument?.querySelector("[data-ui-id=delete] .button-danger")',
    );
    await js(
      'document.querySelector(".ui-debug-stage iframe").contentDocument.querySelector("[data-ui-id=delete] .button-danger").click()',
    );
    await wait(
      'document.querySelector(".ui-debug-message").textContent.includes("deleteDocument")',
    );
    assert.equal(calls.length, projectCalls);
    await js(
      'document.querySelector("[data-debug-entry=ai-run] button").click()',
    );
    await js(
      `{const select=document.querySelector('[aria-label="미리보기 상태"]');select.value='failed';select.dispatchEvent(new Event('change',{bubbles:true}));}`,
    );
    await wait(
      '!!document.querySelector(".ui-debug-stage iframe")?.contentDocument?.querySelector(".ai-failure-details")',
    );
    for (const action of ['copyText', 'revealPath']) {
      await js(
        `document.querySelector('.ui-debug-stage iframe').contentDocument.querySelectorAll('.ai-failure-details button')[${action === 'copyText' ? 0 : 1}].click()`,
      );
      await wait(
        `document.querySelector('.ui-debug-message').textContent.includes('${action}')`,
      );
      assert.equal(calls.length, projectCalls);
    }
    await wait('!document.querySelector(".ui-debug-loading")');
    await fs.mkdir('out/ui-debug-qa', { recursive: true });
    await fs.writeFile(
      'out/ui-debug-qa/native-console.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    f12();
    await wait('!document.querySelector(".ui-debug-console")');
    await js('document.querySelector(".document-card__content").click()');
    await wait('!!document.querySelector(".markdown-editor")');
    const editingCalls = calls.length;
    f12();
    await wait('!!document.querySelector(".ui-debug-console[open]")');
    await js(
      `{const button=document.querySelector('[data-debug-entry=settings] button');button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));button.click();}`,
    );
    await wait(
      '!!document.querySelector(".ui-debug-stage iframe")?.contentDocument?.querySelector(".canvas-settings")',
    );
    assert.equal(
      calls.length,
      editingCalls,
      'console clicks must not finish the live document editor',
    );
    assert.equal(
      await js('document.querySelectorAll(".markdown-editor").length'),
      1,
    );
    await js(
      `Array.from(document.querySelectorAll('.ui-debug-options button')).find(button=>button.textContent==='식별 정보 복사').click()`,
    );
    await wait(
      'document.querySelector(".ui-debug-message").textContent.includes("복사했습니다")',
    );
    assert.equal(
      copied,
      'WorkspaceCanvas / settingsOpen / default / src/ui/App.tsx',
    );
    assert.equal(
      calls.length,
      editingCalls + 1,
      'only the explicit console copy uses IPC',
    );
    f12();
    await wait('!document.querySelector(".ui-debug-console")');
    assert.equal(
      await js('document.querySelectorAll(".markdown-editor").length'),
      1,
    );
    console.log(
      'Native preload / IPC F12 / iframe focus / packaged previews / zero preview IPC / failed-run diagnostics / editor preservation / explicit identifier copy passed.',
    );
  } finally {
    win.destroy();
  }
}
void run()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
