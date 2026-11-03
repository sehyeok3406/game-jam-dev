import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import {
  htmlSourceId,
  htmlSourcePath,
  sourceMetadata,
} from '../src/html-source.ts';
import {
  root,
  profile,
  game,
  boot,
  stop,
  wait,
  js,
  send,
  key,
  mouse,
} from './helpers/packaged-canvas.mjs';

const output = path.resolve('out/unified-file-names-packaged');
await fs.mkdir(output, { recursive: true });
await fs.mkdir(path.join(game, 'docs'), { recursive: true });
await fs.mkdir(path.join(game, 'output'), { recursive: true });
const md = (id, title, x, y, body = '보존할 원문') =>
  matter.stringify(body, {
    id,
    title,
    type: 'idea',
    x,
    y,
    width: 360,
    height: 220,
    custom: 'keep',
  });
await fs.writeFile(
  path.join(game, 'project.md'),
  md('root-doc', '프로젝트 안내', 0, 0),
);
await fs.writeFile(
  path.join(game, 'docs/uuid-1.md'),
  md(
    'batch-one',
    '핵심 설계',
    0,
    280,
    '# 원래 본문 제목\n\n[다른 문서](uuid-2.md)',
  ),
);
await fs.writeFile(
  path.join(game, 'docs/핵심 설계.md'),
  md('occupied', '핵심 설계', 400, 280),
);
await fs.writeFile(
  path.join(game, 'docs/uuid-2.md'),
  md('batch-two', '전투 메모', 800, 280),
);
const original =
  '<html><head><title>원본 내부 제목</title></head><body style="background:#203346;color:white"><h1>유지할 게임 콘텐츠</h1><img src="picture.svg"></body></html>';
await fs.writeFile(path.join(game, 'output/index.html'), original);
await fs.writeFile(
  path.join(game, 'output/picture.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>',
);
const control = htmlSourcePath('output/index.html');
await fs.mkdir(path.dirname(path.join(game, control)), { recursive: true });
await fs.writeFile(
  path.join(game, control),
  sourceMetadata('output/index.html', original, {
    title: '구형 게임',
    x: 100,
    y: 560,
  }),
);
const previews = () => js('window.gameCanvas.listPreviews()');
const capture = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(
    path.join(output, name + '.png'),
    Buffer.from(data, 'base64'),
  );
};
const press = async (selector) => {
  const p = await js(
    `(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
  );
  await mouse('mousePressed', p.x, p.y);
  await mouse('mouseReleased', p.x, p.y);
};
const button = async (within, text) => {
  await wait(
    `(()=>{const container=document.querySelector(${JSON.stringify(within)});return container && [...container.querySelectorAll('button')].some(b=>!b.disabled&&b.textContent.trim().includes(${JSON.stringify(text)}))})()`,
  );
  const p = await js(
    `(()=>{const b=[...document.querySelector(${JSON.stringify(within)}).querySelectorAll('button')].find(b=>b.textContent.trim().includes(${JSON.stringify(text)}));if(!b||b.disabled)throw Error('Missing/enabled button: '+${JSON.stringify(text)});b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
  );
  await mouse('mousePressed', p.x, p.y);
  await mouse('mouseReleased', p.x, p.y);
};
const change = async (selector, text) => {
  await js(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  await key('a', 'KeyA', 65, 2);
  await send('Input.insertText', { text });
};
const dialog = '[role="dialog"][aria-label="파일 이름 통일"]';
const settings = async () => {
  await press('.canvas-main-menu summary');
  await button('.canvas-main-menu', '설정 및 도구');
};
try {
  await boot();
  await wait('!!document.querySelector(".preview-card iframe")');
  await wait('document.body.textContent.includes("4개 Markdown 문서")');
  await new Promise((resolve) => setTimeout(resolve, 600));
  await js(
    'window.__nameIframe=document.querySelector(".preview-card iframe");window.__nameNode=document.querySelector(".preview-card").closest(".react-flow__node").getAttribute("data-id")',
  );
  await press('.preview-card button[aria-label^="HTML 이름 편집:"]');
  await wait(`!!document.querySelector('input[aria-label="HTML 이름"]')`);
  await change('input[aria-label="HTML 이름"]', '잘못된/이름');
  await key('Enter', 'Enter', 13);
  await wait(
    'document.querySelector(".preview-card [role=alert]")?.textContent.includes("문자")',
  );
  assert.equal((await previews())[0].relativePath, 'output/index.html');
  assert.equal(
    await js(`document.querySelector('input[aria-label="HTML 이름"]').value`),
    '잘못된/이름',
  );
  await key('Escape', 'Escape', 27);
  await press('.preview-card button[aria-label^="HTML 이름 편집:"]');
  await change('input[aria-label="HTML 이름"]', '  전투 화면  ');
  await key('Enter', 'Enter', 13);
  await wait(
    'window.gameCanvas.listPreviews().then(p=>p.some(p=>p.relativePath==="output/전투 화면.html"))',
  );
  await wait(
    `document.querySelector('.preview-card button[aria-label^="HTML 이름 편집:"]')?.textContent.trim()==="전투 화면"`,
  );
  assert.equal(
    await fs.readFile(path.join(game, 'output/전투 화면.html'), 'utf8'),
    original,
  );
  assert.equal(
    (await previews())[0].sourceId,
    htmlSourceId('output/index.html'),
  );
  assert.equal(
    await js(
      'window.__nameIframe===document.querySelector(".preview-card iframe")',
    ),
    true,
    'filename-only edit must retain the running iframe',
  );
  assert.equal(
    await js(
      'document.querySelector(".preview-card").closest(".react-flow__node").getAttribute("data-id")===window.__nameNode',
    ),
    true,
  );
  await assert.rejects(fs.access(path.join(game, 'output/index.html')));
  await capture('html-renamed');
  // Native settings entry: inspection must leave source files untouched.
  await settings();
  await button('[aria-label="캔버스 설정"]', '파일 이름 통일');
  await wait(`!!document.querySelector('${dialog}')`);
  assert.equal(
    await js(
      `document.querySelector('${dialog} input[aria-label="project.md 변경 선택"]').disabled`,
    ),
    true,
  );
  assert.equal(
    await js(
      `document.querySelector('${dialog} input[aria-label="docs/uuid-1.md 최종 이름"]').value`,
    ),
    '핵심 설계 (2)',
  );
  await fs.access(path.join(game, 'docs/uuid-1.md'));
  await capture('batch-preview');
  // User-edited final name and a stale snapshot must fail without partial writes.
  await change(
    `${dialog} input[aria-label="docs/uuid-2.md 최종 이름"]`,
    '전투 노트',
  );
  await fs.writeFile(
    path.join(game, 'docs/external.md'),
    md('external', 'external', 1200, 280),
  );
  await button(dialog, '이름 통일');
  await wait(
    `document.querySelector('${dialog} > [role=alert]')?.textContent.includes('다시 확인')`,
  );
  await fs.access(path.join(game, 'docs/uuid-1.md'));
  await fs.access(path.join(game, 'docs/uuid-2.md'));
  await capture('stale-preview');
  await button(dialog, '다시 검사');
  await wait(
    `!document.querySelector('${dialog} > [role=alert]') && !document.querySelector('${dialog} button.button-primary').disabled`,
  );
  await change(
    `${dialog} input[aria-label="docs/uuid-2.md 최종 이름"]`,
    '전투 노트',
  );
  await button(dialog, '이름 통일');
  await wait(
    'window.gameCanvas.listDocuments().then(ds=>ds.some(d=>d.id==="batch-two"&&d.relativePath==="docs/전투 노트.md"))',
  );
  const one = matter(
    await fs.readFile(path.join(game, 'docs/핵심 설계 (2).md'), 'utf8'),
  );
  assert.equal(one.data.id, 'batch-one');
  assert.equal(one.data.title, '핵심 설계 (2)');
  assert.equal(one.data.custom, 'keep');
  assert.match(one.content, /# 원래 본문 제목/);
  assert.match(one.content, /전투%20노트.md/);
  await assert.rejects(fs.access(path.join(game, 'docs/uuid-1.md')));
  await button(dialog, '닫기');
  await press('[title="설정 닫기"]');
  await js('document.activeElement?.blur()');
  await key('z', 'KeyZ', 90, 2);
  await wait(
    'window.gameCanvas.listDocuments().then(ds=>ds.some(d=>d.id==="batch-one"&&d.relativePath==="docs/uuid-1.md"))',
  );
  await fs.access(path.join(game, 'docs/uuid-2.md'));
  await wait(
    `!!document.querySelector('[aria-label="다시 실행"]:not(:disabled)')`,
  );
  await key('Z', 'KeyZ', 90, 10);
  await wait(
    'window.gameCanvas.listDocuments().then(ds=>ds.some(d=>d.id==="batch-two"&&d.relativePath==="docs/전투 노트.md"))',
  );
  // Existing v1 root uses the existing explicit structure upgrade, then the same name flow.
  await settings();
  await button('[aria-label="캔버스 설정"]', '파일 이름 통일');
  await wait(`!!document.querySelector('${dialog} .file-name-upgrade')`);
  await button(`${dialog} .file-name-upgrade`, '프로젝트 파일 구조 정리');
  await wait(
    `!!document.querySelector('[role=dialog][aria-label="프로젝트 파일 구조 정리"]')`,
  );
  await button(
    '[role="dialog"][aria-label="프로젝트 파일 구조 정리"]',
    '파일 구조 정리',
  );
  await wait(
    `!!document.querySelector('${dialog}') && !document.querySelector('${dialog} .file-name-upgrade')`,
  );
  if (
    await js(
      `!!document.querySelector('${dialog} button.button-primary:not(:disabled)')`,
    )
  ) {
    await button(dialog, '이름 통일');
    await wait(
      `document.querySelector('${dialog}')?.textContent.includes('통일할 파일 이름이 없습니다')`,
    );
  }
  await capture('batch-completed');
  await button(dialog, '닫기');
  await stop(true);
  await boot();
  await wait(
    'window.gameCanvas.listDocuments().then(ds=>ds.some(d=>d.id==="batch-one"&&d.relativePath==="docs/핵심 설계 (2).md"))',
  );
  assert.equal(
    (await previews()).find(
      (p) => p.sourceId === htmlSourceId('output/index.html'),
    ).relativePath,
    'output/전투 화면.html',
  );
  assert.equal(
    await fs.readFile(path.join(game, 'output/전투 화면.html'), 'utf8'),
    original,
  );
  await fs.access(path.join(game, 'output/picture.svg'));
  await capture('restarted');
  console.log(
    'PASS: packaged HTML name validation/cancel/save keeps bytes, resources and live iframe; batch inspection/collisions/editing/stale rejection/atomic Undo+Redo, explicit v1 upgrade and full restart preserve names, IDs, body and links.',
  );
} catch (error) {
  if (js) await capture('failure').catch(() => {});
  throw error;
} finally {
  await stop();
  assert.ok(
    path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) &&
      path.basename(root).startsWith('gamejam-resize-packaged-'),
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
