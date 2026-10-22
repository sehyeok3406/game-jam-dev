import assert from 'node:assert/strict';
export async function verifyMaterials({ js, key, mouse, wait, capture }) {
  const click = (selector) =>
    js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const button = (selector, text) =>
    js(
      `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.includes(${JSON.stringify(text)})).click()`,
    );
  await wait('!!document.querySelector(".home-project-open")');
  await click('.home-project-open');
  await wait(
    `[...document.querySelectorAll('.canvas-tabs [role=tab]')].some(e=>e.textContent.includes('재료 A'))`,
  );
  await button('.canvas-tabs [role=tab]', '재료 A');
  await wait(
    `document.querySelector('.canvas-tabs [aria-selected=true]')?.textContent.includes('재료 A') && document.querySelectorAll('.react-flow__node-document').length===3`,
  );
  await js(
    '(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})()',
  );
  await new Promise((r) => setTimeout(r, 250));
  const docs = await js('window.gameCanvas.listDocuments()');
  const first = docs.find((d) => d.title === '직접 쓴 기획'),
    second = docs.find((d) => d.title === 'AI가 정리한 문서');
  const node = (id) => `.react-flow__node[data-id="${id}"]`;
  const center = async (id) =>
    js(
      `(()=>{const r=document.querySelector(${JSON.stringify(node(id))}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
  await click('[aria-label="gamejam!"]');
  await wait('!!document.querySelector("#ai-select-on-canvas")');
  await js(
    `{const e=document.querySelector('#ai-destination-canvas');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'materials-b');e.dispatchEvent(new Event('change',{bubbles:true}));}`,
  );
  const enter = async () => {
    await click('#ai-select-on-canvas');
    await wait('!!document.querySelector(".material-selection-bar")');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(
      await js('!!document.querySelector(".ai-request-dialog")'),
      false,
    );
  };
  const selected = () =>
    js('document.querySelectorAll(".react-flow__node.selected").length');
  await enter();
  await mouse('click', await center(first.id));
  await wait(
    'document.querySelectorAll(".react-flow__node.selected").length===1',
  );
  await mouse('click', await center(second.id));
  await wait(
    'document.querySelectorAll(".react-flow__node.selected").length===2',
  );
  await mouse('click', await center(second.id));
  assert.equal(await selected(), 1);
  await mouse('click', await center(first.id));
  assert.equal(await selected(), 0);
  await mouse('click', await center(first.id));
  await js(`document.querySelector('.material-selection-bar button').focus()`);
  await key({ code: 'KeyD', key: 'ㅇ', shiftKey: true });
  await wait(
    `document.querySelector(${JSON.stringify(node(second.id))}).classList.contains('material-focus')`,
  );
  await new Promise((r) => setTimeout(r, 220));
  const centered = await js(
    `(()=>{const c=document.querySelector('.react-flow').getBoundingClientRect(),r=document.querySelector(${JSON.stringify(node(second.id))}).getBoundingClientRect();return Math.abs((r.left+r.right-c.left-c.right)/2)<3 && Math.abs((r.top+r.bottom-c.top-c.bottom)/2)<3})()`,
  );
  assert.ok(centered, 'keyboard focus centers the camera');
  await key({ code: 'Space', key: ' ' });
  await wait(
    'document.querySelectorAll(".react-flow__node.selected").length===2',
  );
  await key({ code: 'Space', key: ' ', repeat: true });
  assert.equal(await selected(), 2, 'held Space does not toggle repeatedly');
  await key({ code: 'Delete', key: 'Delete' });
  assert.equal(
    (await js('window.gameCanvas.listDocuments()')).length,
    docs.length,
  );
  await button('.material-selection-bar button', '취소');
  await wait('!!document.querySelector(".ai-request-dialog")');
  assert.equal(
    await js('document.querySelector("#ai-destination-canvas").value'),
    'materials-b',
  );
  assert.equal(
    await js('document.querySelectorAll(".ai-input-scope button").length'),
    0,
    'cancel restores original materials',
  );
  await enter();
  // Native marquee selection adds materials without modifier keys.
  await js(`document.querySelector('.react-flow__controls-fitview')?.click()`);
  await new Promise((r) => setTimeout(r, 300));
  await mouse('click', await center(first.id));
  const bounds = await js(
    `(()=>{const r=document.querySelector(${JSON.stringify(node(second.id))}).getBoundingClientRect();return {start:{x:r.left-12,y:r.top-12},end:{x:r.right+12,y:r.bottom+12}}})()`,
  );
  await mouse('drag', bounds.start, bounds.end);
  await wait(
    'document.querySelectorAll(".react-flow__node.selected").length===2',
  );
  await mouse('click', await center(second.id));
  assert.equal(
    await selected(),
    1,
    'marquee keeps the earlier selected material',
  );
  await button('.canvas-tabs [role=tab]', '결과 B');
  await wait(
    'document.querySelectorAll(".react-flow__node-document").length===1',
  );
  const other = await js(
    `(()=>{const r=document.querySelector('.react-flow__node-document').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`,
  );
  await mouse('click', other);
  await wait(
    'document.querySelector(".material-selection-bar .button-primary").textContent.includes("2개")',
  );
  await capture('selection');
  await button('.material-selection-bar button', '선택 완료');
  await wait('!!document.querySelector(".ai-request-dialog")');
  const names = await js(
    '[...document.querySelectorAll(".ai-input-scope button span")].map(e=>e.textContent)',
  );
  assert.deepEqual(names.sort(), ['다른 캔버스 자료', '직접 쓴 기획'].sort());
  assert.equal(
    await js('document.querySelector("#ai-destination-canvas").value'),
    'materials-b',
  );
  await click('#ai-request-next');
  await wait(
    `!!document.querySelector('[data-gamejam-page="2"]:not([hidden])')`,
  );
  assert.equal(
    await js(
      `document.querySelector('#ai-html-result option[value="output/index.html"]').textContent.trim()`,
    ),
    '캔버스 게임 이름',
  );
  await click('#ai-request-next');
  await click('#ai-request-next');
  await click('#ai-request-next');
  await click('#ai-request-next');
  await wait(
    `!!document.querySelector('[data-gamejam-page="5"]:not([hidden])')`,
  );
  const review = await js(
    'document.querySelector(".gamejam-review").textContent',
  );
  assert.match(review, /직접 쓴 기획/);
  assert.match(review, /다른 캔버스 자료/);
  assert.match(review, /결과 B/);
  assert.ok(
    !review.includes('ideas/') &&
      !review.includes('output/') &&
      !review.includes('미분류'),
  );
  await capture('review');
  console.log(
    'PASS: canvas names, destination, additive clicks/marquee, Korean Shift WASD/Space, camera, repeat protection, cross-canvas selection, cancel and completion/review',
  );
}
