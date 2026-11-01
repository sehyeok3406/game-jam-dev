import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import {
  root,
  profile,
  game,
  boot,
  stop,
  wait,
  js,
  send,
  mouse,
  key,
} from './helpers/packaged-canvas.mjs';

const output = path.resolve('out/document-names-packaged');
const original = '# 원본 제목\n\n첫 번째 문단입니다.\n\n두 번째 문단입니다.\n';
await fs.mkdir(output, { recursive: true });
await fs.mkdir(path.join(game, 'docs'), { recursive: true });
await fs.writeFile(
  path.join(game, 'docs/original.md'),
  matter.stringify(original, {
    id: 'native-name',
    title: '원본 제목',
    type: 'idea',
    x: 100,
    y: 100,
    width: 550,
    height: 400,
    custom: 'preserve',
  }),
);
await fs.writeFile(
  path.join(game, 'docs/중복.md'),
  matter.stringify('[연결](original.md)\n', {
    id: 'duplicate-name',
    title: '중복',
    type: 'reference',
    x: 750,
    y: 100,
    width: 400,
    height: 300,
  }),
);
const selector = '[data-find-document="native-name"]';
const record = () =>
  js(
    'window.gameCanvas.listDocuments().then(ds=>ds.find(d=>d.id==="native-name"))',
  );
const click = async (s) => {
  const p = await js(
    `(()=>{const r=document.querySelector(${JSON.stringify(s)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
  );
  await mouse('mousePressed', p.x, p.y);
  await mouse('mouseReleased', p.x, p.y);
};
const capture = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(
    path.join(output, name + '.png'),
    Buffer.from(data, 'base64'),
  );
};
const replaceName = async (name) => {
  if (!(await js(`!!document.querySelector('${selector} header input')`))) {
    await js(
      `document.querySelector('${selector} button.document-card__title').focus()`,
    );
    await key('Enter', 'Enter', 13);
  }
  await wait(
    'document.activeElement?.getAttribute("aria-label")==="문서 제목"',
  );
  await key('a', 'KeyA', 65, 2);
  await send('Input.insertText', { text: name });
};
try {
  await boot();
  await wait(`!!document.querySelector('${selector}')`);
  await replaceName('새 문서 이름');
  await new Promise((r) => setTimeout(r, 1400));
  assert.equal((await record()).relativePath, 'docs/original.md');
  assert.equal((await record()).title, '원본 제목');
  await key('s', 'KeyS', 83, 2);
  await wait(
    'window.gameCanvas.listDocuments().then(ds=>ds.find(d=>d.id==="native-name")?.relativePath==="docs/새 문서 이름.md")',
  );
  assert.equal(
    await js('document.activeElement?.getAttribute("aria-label")'),
    '문서 제목',
  );
  const first = matter(
    await fs.readFile(path.join(game, 'docs/새 문서 이름.md'), 'utf8'),
  );
  assert.equal(first.data.title, '새 문서 이름');
  assert.equal(first.data.custom, 'preserve');
  assert.equal(first.content.trim(), original.trim());
  await assert.rejects(fs.access(path.join(game, 'docs/original.md')));
  assert.match(
    await fs.readFile(path.join(game, 'docs/중복.md'), 'utf8'),
    /새%20문서%20이름.md/,
  );
  await replaceName('잘못된/이름');
  await key('s', 'KeyS', 83, 2);
  await wait(
    `document.querySelector('${selector} [role=alert]')?.textContent.includes('문자')`,
  );
  assert.equal((await record()).title, '새 문서 이름');
  assert.equal(
    await js(`document.querySelector('${selector} header input').value`),
    '잘못된/이름',
  );
  await capture('invalid-name');
  await key('Escape', 'Escape', 27);
  await wait(
    `!!document.querySelector('${selector} button.document-card__title')`,
  );
  await replaceName('중복');
  await key('s', 'KeyS', 83, 2);
  await wait(
    `document.querySelector('${selector} [role=alert]')?.textContent.includes('같은 이름')`,
  );
  assert.equal((await record()).relativePath, 'docs/새 문서 이름.md');
  assert.match(
    await fs.readFile(path.join(game, 'docs/중복.md'), 'utf8'),
    /id: duplicate-name/,
  );
  await replaceName('  정리 이름  ');
  await key('s', 'KeyS', 83, 2);
  await wait(
    `document.querySelector('${selector} header input')?.value==='정리 이름'`,
  );
  assert.equal(
    await js(`!!document.querySelector('${selector} [role=alert]')`),
    false,
  );
  await key('Escape', 'Escape', 27);
  await wait(
    `document.querySelector('${selector} button.document-card__title')?.textContent.trim()==='정리 이름'`,
  );
  assert.equal((await record()).relativePath, 'docs/정리 이름.md');
  await click(`${selector} .markdown-body p`);
  await wait(`!!document.querySelector('${selector} .tiptap')`);
  await send('Input.insertText', { text: '개명 후 입력 ' });
  await key('s', 'KeyS', 83, 2);
  await wait(
    'window.gameCanvas.listDocuments().then(ds=>ds.find(d=>d.id==="native-name")?.body.includes("개명 후 입력"))',
  );
  await key('Escape', 'Escape', 27);
  await wait(`!document.querySelector('${selector} .tiptap')`);
  await js('document.activeElement?.blur()');
  await key('z', 'KeyZ', 90, 2);
  await wait(
    'window.gameCanvas.listDocuments().then(ds=>!ds.find(d=>d.id==="native-name")?.body.includes("개명 후 입력"))',
  );
  await key('z', 'KeyZ', 90, 2);
  await wait(
    'window.gameCanvas.listDocuments().then(ds=>ds.find(d=>d.id==="native-name")?.relativePath==="docs/새 문서 이름.md")',
  );
  await wait(
    `!!document.querySelector('[aria-label="다시 실행"]:not(:disabled)')`,
  );
  assert.equal(
    (await js('window.gameCanvas.getUndoState()')).redo,
    '문서 이름 변경',
  );
  await key('Z', 'KeyZ', 90, 10);
  await wait(
    'window.gameCanvas.listDocuments().then(ds=>ds.find(d=>d.id==="native-name")?.relativePath==="docs/정리 이름.md")',
  );
  await capture('renamed');
  await stop(true);
  await boot();
  await wait(
    `document.querySelector('${selector} .document-card__title')?.textContent.trim()==='정리 이름'`,
  );
  assert.equal((await record()).relativePath, 'docs/정리 이름.md');
  assert.equal((await record()).id, 'native-name');
  const stored = matter(
    await fs.readFile(path.join(game, 'docs/정리 이름.md'), 'utf8'),
  );
  assert.equal(stored.data.custom, 'preserve');
  assert.equal(stored.content.trim(), original.trim());
  await capture('restarted');
  console.log(
    'PASS: Windows native name edit waits for confirmation, saves actual filename/title/references, preserves original body/identity/custom metadata, rejects invalid/duplicate names with retained input, Escape cancels name, subsequent body editing and Undo/Redo/full restart work.',
  );
} catch (error) {
  if (js) await capture('failure').catch(() => {});
  throw error;
} finally {
  await stop();
  assert.ok(
    path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep),
  );
  assert.ok(path.basename(root).startsWith('gamejam-resize-packaged-'));
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
