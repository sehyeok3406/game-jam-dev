import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { app, BrowserWindow, ipcMain } from 'electron';
import { createCollaborationServer } from '../src/collaboration-server';
import { CollaborationClient } from '../src/collaboration-client';
import { snapshotDocuments } from '../src/collaboration-model';
import {
  DocumentSaveQueue,
  type DocumentSaveState,
} from '../src/document-save-queue';
import { DocumentSaveStore } from '../src/document-save-store';
import type { CanvasDocument, SaveDocumentInput } from '../src/shared';
const directory = path.resolve('out/real-save-ui');
app.setPath('userData', path.join(directory, 'profile'));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function run() {
  await app.whenReady();
  const server = await createCollaborationServer({
    dataDirectory: path.join(directory, 'server'),
    creationKey: 'isolated-test',
    port: 0,
  });
  const win = new BrowserWindow({
    show: false,
    width: 1360,
    height: 1000,
    webPreferences: {
      preload: path.resolve('tests/real-save-ui.preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      offscreen: true,
      backgroundThrottling: false,
    },
  });
  let client: CollaborationClient,
    peer: CollaborationClient,
    scope = '',
    metadataTimer: ReturnType<typeof setInterval> | undefined;
  let changedTimer: ReturnType<typeof setTimeout> | undefined,
    delay = 500,
    writes = 0,
    acks = 0,
    metadataUpdates = 0;
  let unlockDelay = 0,
    unlockStarted = 0;
  const errors: string[] = [];
  const samples: {
    mode: string;
    count: number;
    writes: number;
    acks: number;
  }[] = [];
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(details.message);
  });
  const send = (event: string, value?: unknown) => {
    if (!win.webContents.isDestroyed())
      win.webContents.send('save-test:' + event, value);
  };
  const read = (relative: string) => {
    const document = snapshotDocuments({
      [relative]: client.files[relative],
    })[0];
    return document
      ? {
          ...document,
          revision: client.revisions[relative],
          contentRevision: client.properties[relative]?.content ?? 0,
          structureRevision: client.properties[relative]?.structure ?? 0,
        }
      : null;
  };
  const write = async (input: SaveDocumentInput) => {
    writes++;
    await sleep(delay);
    await client.command('documents:save', input);
    acks++;
    return read(input.relativePath)!;
  };
  const queue = new DocumentSaveQueue(
    new DocumentSaveStore(path.join(directory, 'queue')),
    (state: DocumentSaveState) => send('save', state),
  );
  const js = async (code: string) => {
    try {
      return await win.webContents.executeJavaScript(code);
    } catch (error) {
      throw Error(code + '\n' + String(error));
    }
  };
  const wait = async (code: string) => {
    for (let n = 0; n < 300; n++) {
      if (await js(code)) return;
      await sleep(50);
    }
    throw Error('UI timeout: ' + code);
  };
  ipcMain.handle('save-test:invoke', async (event, command, input) => {
    assert.equal(event.sender, win.webContents);
    if (command === 'bootstrap') {
      const files = Object.fromEntries(
        (input as CanvasDocument[]).map((doc) => [
          doc.relativePath,
          matter.stringify('\n' + doc.body + '\n', {
            id: doc.id,
            title: doc.title,
            type: doc.type,
            status: doc.status,
            canvas_id: 'default',
            x: doc.x,
            y: doc.y,
            width: doc.width,
            height: doc.height,
          }),
        ]),
      );
      const created = await CollaborationClient.create(
        `http://127.0.0.1:${server.port}`,
        'isolated-test',
        '작성자',
        '저장 큐 UI 검증',
        files,
      );
      client = new CollaborationClient(
        created.credentials,
        (state, changed) => {
          send('collaboration', state);
          queue.wake();
          if (changed) {
            if (changedTimer) clearTimeout(changedTimer);
            changedTimer = setTimeout(() => send('workspace'), 180);
          }
        },
      );
      client.accept(created.result);
      client.start();
      const joined = await CollaborationClient.join(
        created.credentials.serverUrl,
        created.credentials.inviteCode!,
        '다른 PC',
      );
      peer = new CollaborationClient(joined.credentials, () => {});
      peer.accept(joined.result);
      peer.start();
      scope = `shared:${client.state.projectId}:${client.state.memberId}`;
      await queue.activate({
        scope,
        isCurrent: () => true,
        canSend: () =>
          client.state.connected && !client.offline && !client.outgoing,
        read: async (relative) => read(relative),
        write,
      });
      return scope;
    }
    if (command === 'list')
      return Object.keys(client.files)
        .filter((relative) => relative.endsWith('.md'))
        .map(read)
        .filter(Boolean);
    if (command === 'read') return read(input);
    if (command === 'states') return queue.list(scope);
    if (command === 'enqueue') return queue.enqueue(input);
    if (command === 'flush') return queue.flush(input.scope, input.key);
    if (command === 'discard')
      return queue.discard(input.scope, input.key, input.sequence);
    if (command === 'collaboration') return client.state;
    if (command === 'lock') return client.lock(input);
    if (command === 'unlock') {
      unlockStarted++;
      if (unlockDelay) await sleep(unlockDelay);
      return client.unlock(input);
    }
    if (command === 'save') return write(input);
    if (command === 'color')
      return client.command('documents:set-color', input);
    throw Error('Unknown test operation');
  });
  try {
    await win.loadURL(process.env.QA_URL!);
    await wait('!!document.querySelector(".home-project-open")');
    await js('document.querySelector(".home-project-open").click()');
    await wait('!!document.querySelector(".document-card__content")');
    await js('document.querySelector(".document-card__content").click()');
    await wait(`!!document.querySelector('[aria-label="문서 내용"]')`);
    const relative = await js(
      `document.querySelector('[aria-label="문서 제목"]').closest('.react-flow__node').dataset.id`,
    );
    const target = Object.keys(client.files).find(
      (relativePath) => read(relativePath)?.id === relative,
    )!;
    const other = Object.keys(client.files).find(
      (relativePath) => relativePath !== target && relativePath.endsWith('.md'),
    )!;
    let metadataBusy = false;
    metadataTimer = setInterval(() => {
      if (metadataBusy) return;
      metadataBusy = true;
      void peer
        .command('documents:set-color', {
          relativePath: other,
          color: metadataUpdates % 2 ? 'purple' : 'green',
        })
        .then(() => {
          metadataUpdates++;
        })
        .finally(() => {
          metadataBusy = false;
        });
    }, 900);
    const duration = Number(process.env.GC_SAVE_SOAK_MS ?? '30000');
    const each = duration / 4;
    for (const mode of ['title', 'body', 'source', 'focus']) {
      delay = mode === 'source' ? 1500 : 500;
      if (mode === 'source') {
        await js(`document.querySelector('[aria-label="더 보기"]').click()`);
        await js(
          `[...document.querySelectorAll('button')].find(e=>e.textContent==='Markdown 원문 보기').click()`,
        );
        await wait(`!!document.querySelector('[aria-label="Markdown 내용"]')`);
      }
      if (mode === 'focus') {
        await js(`document.querySelector('[aria-label="더 보기"]').click()`);
        await js(
          `[...document.querySelectorAll('button')].find(e=>e.textContent==='서식 편집으로 전환').click()`,
        );
        await js(`document.querySelector('[aria-label="집중 편집"]').click()`);
        await wait(`!!document.querySelector('[aria-label="메모 집중 편집"]')`);
      }
      const selector =
        mode === 'title'
          ? '[aria-label="문서 제목"]'
          : mode === 'source'
            ? '[aria-label="Markdown 내용"]'
            : '[aria-label="문서 내용"]';
      await sleep(200);
      win.webContents.focus();
      await js(
        `window.soakEditor=document.querySelector(${JSON.stringify(selector)});window.soakEditor.focus();if(window.soakEditor.setSelectionRange)window.soakEditor.setSelectionRange(window.soakEditor.value.length,window.soakEditor.value.length);else{const r=document.createRange();r.selectNodeContents(window.soakEditor);r.collapse(false);const s=window.getSelection();s.removeAllRanges();s.addRange(r);}`,
      );
      await js(
        `window.focusTrace=[];if(!window.tracing){window.tracing=true;for(const name of ['removeChild','appendChild','insertBefore']){const original=Node.prototype[name];Node.prototype[name]=function(...args){if(args[0] instanceof Node&&(args[0]===window.soakEditor||args[0].contains(window.soakEditor)))window.focusTrace.push({method:name,tag:args[0].nodeName,parent:this.nodeName,stack:new Error().stack.split('\\n').slice(1,6).join('\\n')});return original.apply(this,args);};}document.addEventListener('focusout',e=>{if(e.target===window.soakEditor)window.focusTrace.push({event:'focusout',next:e.relatedTarget?.tagName,stack:new Error().stack.split('\\n').slice(1,6).join('\\n')});},true);}`,
      );
      let count = 0;
      const end = Date.now() + each;
      while (Date.now() < end) {
        const focus = await js(
          `({same:document.querySelector(${JSON.stringify(selector)})===window.soakEditor,active:document.activeElement===window.soakEditor,connected:window.soakEditor.isConnected})`,
        );
        if (!focus.same || !focus.active || !focus.connected)
          console.log(
            'Focus diagnostic',
            mode,
            count,
            focus,
            await js(
              '({active:document.activeElement?.tagName,readOnly:window.soakEditor.readOnly,editable:window.soakEditor.contentEditable,overlay:!!document.querySelector("vite-error-overlay"),states:[...document.querySelectorAll(".document-editor__actions [role=status]")].map(e=>e.textContent)})',
            ),
          );
        if (!focus.active)
          console.log('DOM trace', await js('window.focusTrace'));
        if (!focus.active)
          console.log('Queue trace', {
            writes,
            acks,
            states: (await queue.list(scope)).map((s) => ({
              phase: s.phase,
              error: s.error,
              sequence: s.sequence,
              savedSequence: s.savedSequence,
              title: s.latest.title,
              savedTitle: s.saved.title,
            })),
            ui: await js(
              '({rects:window.soakEditor.getClientRects().length,hasFocus:document.hasFocus(),styles:[window.soakEditor,window.soakEditor.parentElement,window.soakEditor.closest(".react-flow__node")].map(e=>({class:e.className,visibility:getComputedStyle(e).visibility,display:getComputedStyle(e).display}))})',
            ),
          });
        assert.deepEqual(
          focus,
          { same: true, active: true, connected: true },
          mode + ': editor remounted or focus lost',
        );
        win.webContents.sendInputEvent({ type: 'char', keyCode: 'q' });
        count++;
        // Exercise title editing without exceeding the server's title limit.
        if (mode === 'title' && count % 80 === 0) {
          win.webContents.sendInputEvent({
            type: 'keyDown',
            keyCode: 'A',
            modifiers: ['control'],
          });
          win.webContents.sendInputEvent({
            type: 'keyUp',
            keyCode: 'A',
            modifiers: ['control'],
          });
          win.webContents.sendInputEvent({ type: 'char', keyCode: 'q' });
        }
        if (count % 25 === 0) {
          win.webContents.sendInputEvent({
            type: 'keyDown',
            keyCode: 'S',
            modifiers: ['control'],
          });
          win.webContents.sendInputEvent({
            type: 'keyUp',
            keyCode: 'S',
            modifiers: ['control'],
          });
        }
        await sleep(125);
      }
      // With no keystrokes, delayed ACKs must preserve the exact selection.
      const selection = () =>
        js(
          `window.soakEditor.setSelectionRange?{start:window.soakEditor.selectionStart,end:window.soakEditor.selectionEnd}:{offset:window.getSelection().anchorOffset,text:window.getSelection().anchorNode?.textContent}`,
        );
      const before = await selection();
      await sleep(1800);
      assert.deepEqual(
        await selection(),
        before,
        mode + ': ACK moved the caret',
      );
      assert.equal(
        await js('document.activeElement===window.soakEditor'),
        true,
      );
      samples.push({ mode, count, writes, acks });
      console.log(
        `PASS: ${mode} editor retained DOM, focus and selection through ${count} native input events; saves=${acks}, peer metadata=${metadataUpdates}`,
      );
    }
    // Typing while the lock-release response is delayed must also be saved.
    unlockDelay = 700;
    const beforeUnlock = unlockStarted;
    win.webContents.sendInputEvent({
      type: 'keyDown',
      keyCode: 'Return',
      modifiers: ['control'],
    });
    win.webContents.sendInputEvent({
      type: 'keyUp',
      keyCode: 'Return',
      modifiers: ['control'],
    });
    for (let tries = 0; tries < 200 && unlockStarted === beforeUnlock; tries++)
      await sleep(25);
    assert.ok(
      unlockStarted > beforeUnlock,
      'finish must begin releasing the lock',
    );
    assert.equal(await js('document.activeElement===window.soakEditor'), true);
    win.webContents.sendInputEvent({ type: 'char', keyCode: 'z' });
    await wait(`!document.querySelector('[aria-label="문서 내용"]')`);
    await queue.flush(scope);
    assert.ok(
      read(target)!.body.endsWith('z'),
      'text typed while finishing must reach the server',
    );
    console.log(
      'PASS: finishing includes input received during a delayed lock-release response',
    );
    assert.ok(acks >= 4);
    assert.ok(metadataUpdates >= 4);
    assert.deepEqual(
      errors.filter(
        (error) =>
          !error.includes(
            'ResizeObserver loop completed with undelivered notifications',
          ),
      ),
      [],
    );
    await peer.refresh();
    assert.equal(
      read(target)!.body,
      snapshotDocuments(peer.files).find((doc) => doc.relativePath === target)!
        .body,
    );
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, 'result.json'),
      JSON.stringify(
        {
          durationMs: duration,
          samples,
          writes,
          acks,
          metadataUpdates,
          errors,
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS: real HTTP/SSE server, lock heartbeat and peer metadata updates; final text converges on the other PC',
    );
  } finally {
    if (metadataTimer) clearInterval(metadataTimer);
    if (changedTimer) clearTimeout(changedTimer);
    queue.dispose();
    client?.stop();
    peer?.stop();
    ipcMain.removeHandler('save-test:invoke');
    await queue.checkpoint();
    await server.close();
    win.destroy();
  }
}
run()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
