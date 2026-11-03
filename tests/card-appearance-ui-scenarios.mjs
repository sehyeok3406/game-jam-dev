import assert from 'node:assert/strict';

export async function cardAppearanceScenarios({
  js,
  wait,
  click,
  key,
  reload,
  screenshot,
  native,
}) {
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  await reload();
  await wait('!!document.querySelector(".home-project-open")');
  await js('document.querySelector(".home-project-open").click()');
  await wait(
    'document.querySelectorAll(".document-card").length>=2&&!!document.querySelector(".preview-card")',
  );
  const [first, second] = await js('window.gameCanvas.listDocuments()');
  const preview = (await js('window.gameCanvas.listPreviews()'))[0];
  const doc = `[data-find-document="${first.id}"]`;
  const background = (selector) =>
    js(
      `getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundColor`,
    );
  const history = () => js('window.gameCanvas.listHistory().then(h=>h.length)');
  const colors = () =>
    js(
      'Promise.all([window.gameCanvas.listDocuments(),window.gameCanvas.listPreviews()]).then(([ds,ps])=>[...ds,...ps].map(d=>[d.relativePath,d.backgroundColor]))',
    );
  const neutral = await background(doc),
    mapSelector = `[data-node-id="${first.id}"]`;
  await js(`document.querySelector('[aria-label="미니맵 전환"]').click()`);
  await wait(`!!document.querySelector(${JSON.stringify(mapSelector)})`);
  const mapFill = await js(
    `getComputedStyle(document.querySelector(${JSON.stringify(mapSelector)})).fill`,
  );
  await js(
    `(async()=>{await window.gameCanvas.setDocumentColor({relativePath:${JSON.stringify(first.relativePath)},color:'pink'});await window.gameCanvas.setDocumentColor({relativePath:${JSON.stringify(preview.relativePath)},color:'blue'});})()`,
  );
  await wait(`document.querySelector('${doc}')?.dataset.cardColor==='pink'`);
  assert.equal(await background(doc), neutral);
  assert.equal(await background('.preview-card > header'), neutral);
  assert.equal(
    await js(
      `getComputedStyle(document.querySelector(${JSON.stringify(mapSelector)})).fill`,
    ),
    mapFill,
  );
  await js(
    `document.querySelector('.canvas-dock [aria-label="작업 패널 닫기"]')?.click()`,
  );
  await click('[aria-label="캔버스 전체 맞춤"]');
  await pause(400);
  const beforeColors = await colors(),
    beforeHistory = await history();
  assert.equal(beforeColors.find(([p]) => p === first.relativePath)[1], 'pink');
  assert.equal(
    beforeColors.find(([p]) => p === preview.relativePath)[1],
    'blue',
  );
  for (const selector of [doc, '.preview-card']) {
    const p = await js(
      `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).querySelector(".canvas-file-header").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
    );
    await js(
      `document.querySelector(${JSON.stringify(selector)}).querySelector('.canvas-file-header').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:${p.x},clientY:${p.y}}))`,
    );
    for (const type of ['mouseDown', 'mouseUp'])
      native({ type, ...p, button: 'right', clickCount: 1 });
    await pause(100);
    await js(
      `document.querySelector(${JSON.stringify(selector)}).querySelector('.canvas-file-header').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:${p.x},clientY:${p.y}}))`,
    );
    await wait('!!document.querySelector(".card-color-unavailable button")');
    assert.equal(
      await js(
        'document.querySelector(".card-color-unavailable button").disabled',
      ),
      true,
    );
    await js(
      'document.querySelector(".card-color-unavailable button").click()',
    );
    assert.deepEqual(await colors(), beforeColors);
    assert.equal(await history(), beforeHistory);
    await key('Escape');
  }
  const point = async (id) =>
    js(
      `(()=>{const r=document.querySelector('[data-find-document="'+${JSON.stringify(id)}+'"] .canvas-file-header').getBoundingClientRect();return {x:Math.round(r.left+3),y:Math.round(r.top+r.height/2)}})()`,
    );
  const pointer = async (p, button = 'left') => {
    for (const type of ['mouseDown', 'mouseUp'])
      native({ type, ...p, button, clickCount: 1 });
    await pause(100);
  };
  await pointer(await point(first.id));
  native({ type: 'keyDown', keyCode: 'Shift' });
  await pause(80);
  await pointer(await point(second.id));
  native({ type: 'keyUp', keyCode: 'Shift' });
  await pause(80);
  await wait(
    'document.querySelectorAll(".react-flow__node-document.selected").length===2',
  );
  await pointer(await point(first.id), 'right');
  await wait('!!document.querySelector("[data-ui-id=selection-menu]")');
  assert.equal(
    await js(
      'document.querySelector("[data-ui-id=selection-menu] .card-color-unavailable button").disabled',
    ),
    true,
  );
  await js(
    'document.querySelector("[data-ui-id=selection-menu] .card-color-unavailable button").click()',
  );
  assert.deepEqual(await colors(), beforeColors);
  assert.equal(await history(), beforeHistory);
  await screenshot('color-disabled');
  await key('Escape');
  assert.equal(
    await js(
      'document.querySelectorAll(".document-card .card-actions button").length',
    ),
    0,
  );
  await click(`${doc} .canvas-file-header [title="문서 상세 정보"]`);
  await wait('!!document.querySelector(".canvas-dock .object-inspector")');
  assert.equal(
    await js(
      'document.querySelectorAll(".canvas-dock__header > button").length',
    ),
    1,
  );
  assert.equal(
    await js(
      'document.querySelectorAll(".canvas-dock .object-inspector > header .icon-button").length',
    ),
    0,
  );
  await click('[aria-label="속성 선택 화면으로 돌아가기"]');
  await wait(
    '!!document.querySelector(".canvas-dock .canvas-panel-empty")&&!document.querySelector(".canvas-dock .object-inspector")',
  );
  assert.equal(
    await js(
      'document.activeElement===document.querySelector(".canvas-dock nav button[aria-pressed=true]")',
    ),
    true,
  );
  await click('[aria-label="작업 패널 닫기"]');
  await wait('!document.querySelector(".canvas-dock")');
  await click(`${doc} .canvas-file-header [title="문서 상세 정보"]`);
  await wait('!!document.querySelector(".canvas-dock")');
  await js('document.querySelector(".inspector-back-button").focus()');
  await key('Escape');
  await wait('!document.querySelector(".canvas-dock")');
  assert.equal(
    await js(
      `document.activeElement===document.querySelector('${doc} .canvas-file-header [title="문서 상세 정보"]')`,
    ),
    true,
  );
  for (const theme of ['light', 'dark']) {
    await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    await pause(100);
    assert.equal(
      await background(doc),
      await background('.preview-card > header'),
    );
    await screenshot('neutral-' + theme);
  }
  console.log(
    'PASS: disabled single MD/HTML and native multi-selection color controls, unchanged colors/history, neutral card/minimap themes, one detail entry, distinct back/close/Escape and focus return.',
  );
}
