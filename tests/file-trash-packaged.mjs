import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import {
  boot,
  stop,
  wait,
  js,
  root,
  profile,
  game,
} from './helpers/packaged-canvas.mjs';

const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAwAAAAECAYAAAC6Jt6KAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAUSURBVBhXY2AgB8hN+P+fWEx7DQBvzVgtcyg/0wAAAABJRU5ErkJggg==',
  'base64',
);
const imagePath = 'assets/images/trash-test.png';
const asset = path.join(game, imagePath);
const relative = 'docs/이미지 검사.md';
const documentFile = path.join(game, relative);
const markdown = matter.stringify(`![원본](../${imagePath})\n`, {
  id: 'trash-image',
  title: '이미지 검사',
  type: 'image',
  x: 600,
  y: 220,
  width: 180,
  height: 160,
  asset: {
    path: imagePath,
    purpose: 'asset',
    originalName: 'trash-test.png',
    mime: 'image/png',
    bytes: image.length,
  },
});
const node = `document.querySelector('[data-id="trash-image"] .asset-node-surface')`;
const findButton = (root, label) =>
  `[...document.querySelectorAll(${JSON.stringify(root)})].find(button => button.textContent.trim() === ${JSON.stringify(label)} && !button.disabled)`;
async function clickButton(root, label) {
  const button = findButton(root, label);
  await wait(`!!${button}`);
  await js(`${button}.click()`);
}

async function removeImage() {
  await wait(`!!${node}?.querySelector('img')`);
  await js(`(() => {
    const card = ${node}, r = card.getBoundingClientRect();
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.x + 6, clientY: r.y + 6 }));
  })()`);
  const action = `[...document.querySelectorAll('[role="menuitem"]')].find(item => item.querySelector('strong')?.textContent.trim() === '삭제')`;
  await wait(`!!${action}`);
  await js(`${action}.click()`);
  await clickButton('[data-ui-id="delete"] button', '휴지통으로 이동');
  await wait(`!${node}`);
  await assert.rejects(fs.access(documentFile), { code: 'ENOENT' });
  await assert.rejects(fs.access(asset), { code: 'ENOENT' });
}

async function openFileBin() {
  const bin = `[...document.querySelectorAll('.home-sidebar-bottom button')].find(button => button.textContent.trim().startsWith('휴지통'))`;
  const home = `document.querySelector('button[title="프로젝트 홈으로 돌아가기"]')`;
  await wait(`!!${bin} || !!${home}`);
  if (!(await js(`!!${bin}`))) await js(`${home}.click()`);
  await wait(`!!${bin}`);
  await js(`${bin}.click()`);
  await wait(
    `document.querySelector('.project-trash-tabs button[aria-pressed="true"]')?.textContent.trim() === '프로젝트'`,
  );
  await clickButton('.project-trash-tabs button', '파일');
  await wait(
    `document.querySelector('[aria-label="파일 휴지통"] article')?.textContent.includes('이미지 검사')`,
  );
}

try {
  await fs.mkdir(path.dirname(asset), { recursive: true });
  await fs.mkdir(path.dirname(documentFile), { recursive: true });
  await fs.writeFile(asset, image);
  await fs.writeFile(documentFile, markdown);
  await boot();
  const originalMarkdown = await fs.readFile(documentFile, 'utf8');
  await removeImage();
  for (const [label, visible] of [
    ['실행 취소', true],
    ['다시 실행', false],
  ]) {
    const button = `document.querySelector('button[aria-label="${label}"]:not(:disabled)')`;
    await wait(`!!${button}`);
    await js(`${button}.click()`);
    await wait(`${visible ? '!!' : '!'}${node}`);
    assert.equal(
      await fs.access(asset).then(
        () => true,
        () => false,
      ),
      visible,
    );
  }
  await js(
    `document.querySelector('button[title="프로젝트 홈으로 돌아가기"]').click()`,
  );
  await openFileBin();
  await stop(true);
  await boot(false);
  await openFileBin();
  await clickButton('[aria-label="파일 휴지통"] button', '복원');
  await wait(`!document.querySelector('[aria-label="파일 휴지통"] article')`);
  assert.equal(await fs.readFile(documentFile, 'utf8'), originalMarkdown);
  assert.deepEqual(await fs.readFile(asset), image);
  await clickButton('.project-trash-modal header button', '닫기');
  await js(`document.querySelector('.home-project-open').click()`);
  await removeImage();
  await js(
    `document.querySelector('button[title="프로젝트 홈으로 돌아가기"]').click()`,
  );
  await openFileBin();
  await clickButton('[aria-label="파일 휴지통"] button', '휴지통에서 제거…');
  await clickButton('.project-trash-confirm button', '제거');
  await wait(`!document.querySelector('[aria-label="파일 휴지통"] article')`);
  assert.deepEqual(await js('window.gameCanvas.listFileTrash()'), []);
  await assert.rejects(fs.access(asset), { code: 'ENOENT' });
  console.log(
    'PASS: Windows image deletion moves the original, Undo/Redo works, and the home file bin restores after restart or removes the archived copy.',
  );
} finally {
  await stop();
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.equal(
    path.dirname(profile),
    path.resolve(process.env.APPDATA, 'Game Canvas', 'test-users'),
  );
  for (const directory of [root, profile])
    await fs.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
}
