import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-links-package-'));
const game = path.join(root, 'game');
let profileId = randomUUID();
const profileBase = path.join(process.env.APPDATA, 'Game Canvas', 'test-users');
let profile = path.join(profileBase, profileId);
const profiles = [profile];
const executable = path.resolve('out/Game Jam!-win32-x64/Game Canvas.exe');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await fs.mkdir(path.join(game, 'docs'), { recursive: true });
await fs.mkdir(path.join(game, '.canvas'));
await fs.mkdir(profile, { recursive: true });
await fs.mkdir('out/document-links-ui', { recursive: true });
await fs.writeFile(
  path.join(game, '.canvas', 'project.json'),
  JSON.stringify({ name: '문서 링크 패키지 검증' }),
);
await fs.writeFile(
  path.join(game, '.canvas', 'canvases.json'),
  JSON.stringify({
    version: 1,
    canvases: [
      { id: 'default', name: '기본 캔버스' },
      { id: 'second', name: '대상 캔버스' },
    ],
  }),
);
await fs.writeFile(
  path.join(game, 'project.md'),
  '---\nid: a\ntitle: 링크 원본\ntype: idea\nx: 80\ny: 80\nwidth: 480\nheight: 460\n---\n[옛 이름](gamejam://document/b "gamejam:auto-title")\n\n[설명 유지](gamejam://document/b)\n\n본문',
);
await fs.writeFile(
  path.join(game, 'docs', 'target.md'),
  '---\nid: b\ntitle: 전투 시스템\ntype: system\ncanvas_id: second\ncollapsed: true\nx: 80\ny: 80\nwidth: 480\nheight: 460\n---\n대상 본문',
);
await fs.writeFile(
  path.join(game, 'docs', 'legacy.md'),
  '---\ntitle: ID 없는 파일\nx: 680\ny: 80\n---\n기존 파일',
);
await fs.writeFile(
  path.join(profile, 'local-projects.json'),
  JSON.stringify([
    {
      id: 'local:' + game.toLowerCase(),
      root: game,
      name: '문서 링크 패키지 검증',
      kind: 'local',
      lastOpenedAt: Date.now(),
    },
  ]),
);
let child, ws, session;
async function launch() {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  child = spawn(
    executable,
    [
      `--game-canvas-test-profile=${profileId}`,
      `--remote-debugging-port=${port}`,
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let diagnostic = '';
  child.stderr.on('data', (data) => {
    diagnostic = (diagnostic + data.toString()).slice(-4000);
  });
  child.once('error', (error) => {
    diagnostic += error.message;
  });
  let target;
  for (let i = 0; i < 160; i++) {
    try {
      target = (
        await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
      ).find((p) => p.type === 'page' && p.url.includes('index.html'));
      if (target) break;
    } catch {}
    await sleep(100);
  }
  assert.ok(
    target,
    'Packaged application did not load: exit=' +
      child.exitCode +
      ' ' +
      diagnostic,
  );
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  ws.addEventListener('message', ({ data }) => {
    const result = JSON.parse(String(data));
    const wait = pending.get(result.id);
    if (!wait) return;
    pending.delete(result.id);
    if (result.error) wait.reject(Error(JSON.stringify(result.error)));
    else wait.resolve(result.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const js = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw Error(
        expression +
          '\n' +
          (result.exceptionDetails.exception?.description ??
            result.exceptionDetails.text),
      );
    return result.result.value;
  };
  const wait = async (expression) => {
    for (let i = 0; i < 160; i++) {
      if (await js(expression)) return;
      await sleep(75);
    }
    throw Error('Timeout: ' + expression);
  };
  const screenshot = async (name) => {
    const result = await send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(
      `out/document-links-ui/${name}.png`,
      Buffer.from(result.data, 'base64'),
    );
  };
  return { js, wait, send, screenshot };
}
async function close(session) {
  if (session && child?.exitCode === null) {
    // Let Chromium persist its OS encryption key before testing a normal restart.
    void session.js('window.close()').catch(() => {});
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      sleep(3000),
    ]);
  }
  ws?.close();
  ws = undefined;
  if (child?.exitCode === null) {
    child.kill();
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once('exit', resolve);
    });
  }
  child = undefined;
}
try {
  session = await launch();
  let { js, wait } = session;
  await wait('!!document.querySelector(".home-project-open")');
  await js('document.querySelector(".home-project-open").click()');
  await wait(
    'document.querySelector("[data-id=a] .document-link")?.textContent==="전투 시스템"',
  );
  assert.equal(
    (await js('window.gameCanvas.getDocument("docs/legacy.md")'))
      .identitySource,
    'path',
  );
  const originalBytes = await fs.readFile(
    path.join(game, 'project.md'),
    'utf8',
  );
  await js(
    'window.gameCanvas.saveDocument({relativePath:"docs/target.md",title:"전투·스킬 시스템",body:"대상 본문"})',
  );
  await wait(
    'document.querySelector("[data-id=a] .document-link")?.textContent==="전투·스킬 시스템"',
  );
  assert.equal(
    await fs.readFile(path.join(game, 'project.md'), 'utf8'),
    originalBytes,
    'Title updates never rewrite source file',
  );
  assert.equal(
    await js(
      'document.querySelectorAll("[data-id=a] .document-link")[1].textContent',
    ),
    '설명 유지',
  );
  await js(
    'document.querySelector("[data-id=a] .document-card__content").click()',
  );
  await wait('!!document.querySelector(".tiptap [data-document-link]")');
  await js(`document.querySelector('[aria-label="더 보기"]').click()`);
  await wait(
    `[...document.querySelectorAll('button')].some(b=>b.textContent==='Markdown 원문 보기')`,
  );
  await js(
    `[...document.querySelectorAll('button')].find(b=>b.textContent==='Markdown 원문 보기').click()`,
  );
  await wait('!!document.querySelector("textarea")');
  await js(
    '{const e=document.querySelector("textarea");e.focus();e.setSelectionRange(e.value.length,e.value.length)}',
  );
  await js(
    `document.querySelector('[aria-label="문서 링크 (Ctrl+K)"]').click()`,
  );
  await wait('!!document.querySelector(".document-link-picker")');
  await js(
    `{const e=document.querySelector('[aria-label="연결할 문서 검색"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'전투·스킬 시스템');e.dispatchEvent(new Event('input',{bubbles:true}));}`,
  );
  await js(
    `document.querySelector('[aria-label="연결할 문서 검색"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))`,
  );
  await wait(
    'document.querySelector("textarea").value.match(/gamejam:auto-title/g)?.length===2',
  );
  await js(
    'document.querySelector("textarea").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",ctrlKey:true,bubbles:true,cancelable:true}))',
  );
  await wait('!document.querySelector("textarea")');
  const saved = await js('window.gameCanvas.getDocument("project.md")');
  assert.equal(saved.body.match(/gamejam:auto-title/g).length, 2);
  await js('document.querySelector("[data-id=a] .document-link").click()');
  await wait(
    'document.querySelector("[role=tab][aria-selected=true]").textContent.includes("대상 캔버스")',
  );
  await wait('!!document.querySelector("[data-id=b] .document-card__content")');
  assert.equal(
    (await js('window.gameCanvas.getDocument("docs/target.md")')).collapsed,
    true,
  );
  await js(
    'document.querySelector(".document-backlinks summary").click();document.querySelector(".document-backlinks button").click()',
  );
  await wait('!!document.querySelector("[data-id=a] .document-link")');
  await session.screenshot('packaged-links');
  await close(session);
  // Reopen the same on-disk project with a fresh isolated profile, so this test
  // verifies document persistence independently of Windows session encryption.
  profileId = randomUUID();
  profile = path.join(profileBase, profileId);
  profiles.push(profile);
  await fs.mkdir(profile, { recursive: true });
  await fs.writeFile(
    path.join(profile, 'local-projects.json'),
    JSON.stringify([
      {
        id: 'local:' + game.toLowerCase(),
        root: game,
        name: '문서 링크 패키지 재열기',
        kind: 'local',
        lastOpenedAt: Date.now(),
      },
    ]),
  );
  session = await launch();
  ({ js, wait } = session);
  await wait(
    '!!document.querySelector(".home-project-open") || !!document.querySelector("[data-id=a]")',
  );
  await js('document.querySelector(".home-project-open")?.click()');
  await wait(
    'document.querySelectorAll("[data-id=a] .document-link").length===3',
  );
  assert.equal(
    (await js('window.gameCanvas.getDocument("project.md")')).body,
    saved.body,
  );
  assert.equal(
    await js(
      'document.querySelector("[data-id=a] .document-link").textContent',
    ),
    '전투·스킬 시스템',
  );
  await js(
    'window.gameCanvas.deleteDocument({documentId:"b",relativePath:"docs/target.md"})',
  );
  await wait(
    'document.querySelectorAll("[data-id=a] .document-link--missing").length===3',
  );
  await js('document.querySelector("[data-id=a] .document-link").click()');
  await wait(
    'document.querySelector(".status-toast").textContent.includes("연결 대상 없음")',
  );
  await js('window.gameCanvas.undo()');
  await wait(
    'document.querySelectorAll("[data-id=a] .document-link--missing").length===0',
  );
  console.log(
    'PASS: Windows package reopens saved links in a fresh process/profile, renews page titles without writing source files, distinguishes legacy files, inserts links and navigates across canvases with private expansion/backlinks, handles deletion and restoration',
  );
} catch (error) {
  if (ws?.readyState === WebSocket.OPEN) {
    await session?.screenshot('packaged-failure').catch(() => {});
    console.error(
      await session
        ?.js(
          '({title:document.title,body:document.body.innerText.slice(-2000)})',
        )
        .catch(() => null),
    );
  }
  throw error;
} finally {
  await close();
  assert.ok(root.startsWith(os.tmpdir() + path.sep));
  for (const testProfile of profiles) {
    assert.ok(testProfile.startsWith(profileBase + path.sep));
    await fs.rm(testProfile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
  await fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
