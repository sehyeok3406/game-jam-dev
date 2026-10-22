import assert from 'node:assert/strict';
import matter from 'gray-matter';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-r04-packaged-'));
const profileId = randomUUID(),
  profile = path.join(
    process.env.APPDATA,
    'Game Canvas',
    'test-users',
    profileId,
  ),
  game = path.join(root, 'game');
await fs.mkdir(game, { recursive: true });
await fs.writeFile(
  path.join(game, 'project.md'),
  '---\nid: project\ntitle: original\nproject_name: original\ncustom: preserve\n---\n# 원본 한글 내용\n',
);
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, 'local-projects.json'),
  JSON.stringify([
    {
      id: 'local:' + game.toLowerCase(),
      root: game,
      name: '프로젝트 홈 패키지 검사',
      kind: 'local',
      lastOpenedAt: Date.now(),
    },
  ]),
);
async function port() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const n = s.address().port;
  await new Promise((r) => s.close(r));
  return n;
}
const pause = () => new Promise((r) => setTimeout(r, 100));
let child, ws, js, send;
async function boot() {
  const debugPort = await port();
  child = spawn(
    path.resolve('out/Game Jam!-win32-x64/Game Canvas.exe'),
    [
      `--game-canvas-test-profile=${profileId}`,
      `--remote-debugging-port=${debugPort}`,
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let diagnostic = '';
  child.stderr.on(
    'data',
    (d) => (diagnostic = (diagnostic + d.toString()).slice(-1000)),
  );
  let target;
  for (let n = 0; n < 160; n++) {
    try {
      target = (
        await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) =>
          r.json(),
        )
      ).find((p) => p.type === 'page' && p.url.includes('index.html'));
      if (target) break;
    } catch {}
    await pause();
  }
  assert.ok(target, diagnostic || 'Package did not load');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener('open', r, { once: true });
    ws.addEventListener('error', j, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', ({ data }) => {
    const m = JSON.parse(String(data)),
      p = pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      if (m.error) p.reject(Error(JSON.stringify(m.error)));
      else p.resolve(m.result);
    }
  });
  send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const next = ++id;
      pending.set(next, { resolve, reject });
      ws.send(JSON.stringify({ id: next, method, params }));
    });
  js = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails)
      throw Error(
        r.exceptionDetails.exception?.description ?? r.exceptionDetails.text,
      );
    return r.result.value;
  };
  await wait('!!window.gameCanvas');
  await wait(
    '!!document.querySelector(".home-project-open") || !!document.querySelector("[data-plugin-launcher]")',
  );
}
async function wait(code) {
  for (let n = 0; n < 160; n++) {
    if (await js(code)) return;
    await pause();
  }
  throw Error('Timeout: ' + code);
}
async function stop(graceful = false) {
  if (graceful && child && child.exitCode === null) {
    let timer;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    void js('window.close()').catch(() => undefined);
    try {
      await Promise.race([
        exited,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error('Package did not close normally')),
            10000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  ws?.close();
  ws = null;
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise((r) => child.once('exit', r));
  }
  await pause();
}
const call = (method, ...args) =>
  js(
    `window.gameCanvas[${JSON.stringify(method)}](...${JSON.stringify(args)})`,
  );
const documentRaw =
  '---\nid: note\ntitle: 검증 문서\ntype: idea\nx: 10\ny: 20\ncustom: keep\n---\n한글 원본 [[project]]\n';
const sectionRaw =
  '---\nid: section-a\ntitle: 검증 섹션\ntype: section\nstatus: active\nx: 0\ny: 0\nwidth: 600\nheight: 400\ncustom:\n  nested: keep\nmembers:\n  - id: note\n    path: docs/note.md\n---\n# 사용자 섹션 본문\n\n한글 설명 [[note]] 보존\n';
await fs.mkdir(path.join(game, 'docs'));
await fs.mkdir(path.join(game, 'sections'));
await fs.writeFile(path.join(game, 'docs/note.md'), documentRaw);
await fs.writeFile(path.join(game, 'sections/a.md'), sectionRaw);
await fs.writeFile(
  path.join(game, 'sections/b.md'),
  matter.stringify(matter(sectionRaw).content, {
    ...matter(sectionRaw).data,
    id: 'section-b',
    members: [],
  }),
);
const raw = (relative) => fs.readFile(path.join(game, relative), 'utf8');
const sectionBody = matter(sectionRaw).content;
try {
  await boot();
  await js('document.querySelector(".home-project-open").click()');
  await wait(
    `window.gameCanvas.getWorkspace().then(w=>w.root===${JSON.stringify(game)})`,
  );
  await wait('!!document.querySelector("[data-plugin-launcher]")');
  const initialHistory = (await call('listHistory')).length;
  await assert.rejects(
    call('deleteSection', {
      relativePath: 'sections/a.md',
      sectionId: 'replaced-section',
      deleteMembers: true,
    }),
    /섹션/,
  );
  await assert.rejects(
    call('duplicateDocuments', {
      documents: [{ id: 'replaced-note', path: 'docs/note.md' }],
    }),
    /복사할 문서/,
  );
  await assert.rejects(
    call('updateDocumentLayout', {
      relativePath: 'docs/note.md',
      objectId: 'replaced-note',
      x: 100,
      y: 120,
      width: 500,
      height: 400,
    }),
    /식별자/,
  );
  await assert.rejects(
    call('updateSectionLayout', {
      relativePath: 'sections/a.md',
      objectId: 'replaced-section',
      x: 100,
      y: 120,
      width: 600,
      height: 400,
    }),
    /섹션/,
  );
  assert.equal(await raw('docs/note.md'), documentRaw);
  assert.equal(await raw('sections/a.md'), sectionRaw);
  assert.equal((await call('listHistory')).length, initialHistory);
  console.log(
    'PASS: actual package IPC rejects stale section delete/copy/document and section layout without changing files or recording history',
  );
  await call('updateSectionLayout', {
    relativePath: 'sections/a.md',
    objectId: 'section-a',
    x: 100,
    y: 120,
    width: 600,
    height: 400,
  });
  assert.equal(matter(await raw('sections/a.md')).content, sectionBody);
  assert.deepEqual(matter(await raw('sections/a.md')).data.custom, {
    nested: 'keep',
  });
  assert.equal(matter(await raw('docs/note.md')).data.x, 110);
  assert.equal((await call('listHistory')).length, initialHistory + 1);
  await call('undo');
  assert.equal(await raw('sections/a.md'), sectionRaw);
  assert.equal(await raw('docs/note.md'), documentRaw);
  await call('redo');
  assert.equal(matter(await raw('sections/a.md')).content, sectionBody);
  const beforeRename = (await call('listHistory')).length;
  await call('renameSection', 'sections/a.md', '이름 변경');
  assert.equal((await call('listHistory')).length, beforeRename + 1);
  assert.equal((await call('getUndoState')).undo, '섹션 이름 변경');
  await call('undo');
  assert.equal(matter(await raw('sections/a.md')).data.title, '검증 섹션');
  await call('redo');
  const [copy] = await call('duplicateDocuments', {
    documents: [{ id: 'note', path: 'docs/note.md' }],
    offsetX: 32,
    offsetY: 32,
  });
  assert.match(copy.id, /^note-copy-/);
  assert.equal(matter(await raw(copy.relativePath)).data.custom, 'keep');
  await call('undo');
  await assert.rejects(fs.access(path.join(game, copy.relativePath)), {
    code: 'ENOENT',
  });
  await call('redo');
  assert.equal(
    matter(await raw(copy.relativePath)).content,
    matter(documentRaw).content,
  );
  console.log(
    'PASS: section body/custom metadata and native copy IDs survive move/rename/copy with one history acknowledgement and undo/redo',
  );
  const deletion = await call('deleteSection', {
    relativePath: 'sections/a.md',
    sectionId: 'section-a',
    deleteMembers: true,
  });
  assert.equal(deletion.deletedDocumentCount, 1);
  await assert.rejects(fs.access(path.join(game, 'docs/note.md')), {
    code: 'ENOENT',
  });
  await assert.rejects(fs.access(path.join(game, 'sections/a.md')), {
    code: 'ENOENT',
  });
  const other = matter(await raw('sections/b.md'));
  assert.deepEqual(other.data.members, []);
  assert.equal(other.content, sectionBody);
  assert.deepEqual(other.data.custom, { nested: 'keep' });
  await call('undo');
  assert.equal((await call('getDocument', 'docs/note.md')).id, 'note');
  assert.equal(matter(await raw('sections/a.md')).data.members[0].id, 'note');
  assert.equal(matter(await raw('sections/a.md')).content, sectionBody);
  assert.deepEqual(matter(await raw('sections/a.md')).data.custom, {
    nested: 'keep',
  });
  assert.ok(await call('getFileAuthorship', 'docs/note.md'));
  console.log(
    'PASS: actual Windows section/member trash and undo restore preserve user body, custom metadata, membership and unrelated sections through extracted history/path services',
  );
  await stop(true);
  await boot();
  if ((await call('getWorkspace')).root !== game)
    await call('openProject', 'local:' + game.toLowerCase());
  assert.equal((await call('getDocument', 'docs/note.md')).id, 'note');
  assert.equal(matter(await raw('sections/a.md')).content, sectionBody);
  assert.equal(matter(await raw(copy.relativePath)).data.id, copy.id);
  assert.ok((await call('listHistory')).length > initialHistory);
  console.log(
    'PASS: complete package restart retains section content, copied documents and legacy history files',
  );
} finally {
  await stop();
  assert.ok(
    path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep),
  );
  assert.ok(
    path
      .resolve(profile)
      .startsWith(
        path.resolve(process.env.APPDATA, 'Game Canvas', 'test-users') +
          path.sep,
      ),
  );
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(profile, { recursive: true, force: true });
}
