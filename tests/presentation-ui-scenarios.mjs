import assert from 'node:assert/strict';

export async function presentationUiScenarios({
  js,
  key,
  wait,
  pointer,
  screenshot,
}) {
  const call = (method, ...args) =>
    js(
      `window.gameCanvas[${JSON.stringify(method)}](...${JSON.stringify(args)})`,
    );
  const history = async () => (await call('listHistory')).length;
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const ready = () =>
    wait(
      `!!document.querySelector('button[title^="실행 취소"]:not(:disabled)')`,
    );
  const shortcut = async (name, modifiers = []) => {
    await js('document.activeElement?.blur()');
    await key(name, modifiers);
  };
  const click = async (selector) => {
    await wait(
      `!!document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`,
    );
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  const originals = await call('listDocuments');
  let section = (await call('listSections'))[0];
  if (!section)
    section = await call('createSection', {
      title: '원래 섹션',
      canvasId: 'default',
      x: originals[0].x - 48,
      y: originals[0].y - 72,
      width: 600,
      height: 600,
      members: [{ id: originals[0].id, path: originals[0].relativePath }],
    });
  const sectionNode = `[data-id="section:${section.id}"]`;
  async function selectSection() {
    await shortcut('1', ['shift']);
    await pause(350);
    await wait(
      `!!document.querySelector(${JSON.stringify(sectionNode + ' .section-card__header')})`,
    );
    const point = await js(
      `(()=>{const node=document.querySelector(${JSON.stringify(sectionNode)}),r=node.querySelector('.section-card__header').getBoundingClientRect();const y=Math.round(r.y+r.height/2);for(let x=Math.ceil(r.x)+8;x<r.right-8;x+=8){const hit=document.elementFromPoint(x,y);if(hit?.closest('.react-flow__node')===node&&!hit.closest('button'))return {x,y};}throw Error('No unobstructed section header point');})()`,
    );
    await pointer('mouseDown', point);
    await pointer('mouseUp', point);
    await wait(
      `!!document.querySelector(${JSON.stringify(sectionNode + '.selected')})`,
    );
  }
  async function openRename() {
    await selectSection();
    await wait(
      `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='이름 변경'&&!b.disabled)`,
    );
    await js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='이름 변경'&&!b.disabled).click()`,
    );
    await wait('!!document.querySelector("[data-ui-id=section-rename]")');
  }
  await openRename();
  const beforeRename = await history();
  await js(
    `{const input=document.querySelector('[aria-label="새 섹션 이름"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'한글 새 섹션');input.dispatchEvent(new Event('input',{bubbles:true}));}`,
  );
  await wait(
    `document.querySelector('[aria-label="새 섹션 이름"]').value==='한글 새 섹션'`,
  );
  await js(
    `{const button=document.querySelector('[data-ui-id=section-rename] .button-primary');button.click();button.click();}`,
  );
  await wait('!document.querySelector("[data-ui-id=section-rename]")');
  await ready();
  let renamed = (await call('listSections')).find(
    (item) => item.id === section.id,
  );
  assert.equal(renamed.title, '한글 새 섹션');
  assert.equal(renamed.relativePath, section.relativePath);
  assert.deepEqual(renamed.members, section.members);
  assert.equal(await history(), beforeRename + 1);
  await shortcut('Z', ['control']);
  await wait(
    `window.gameCanvas.listSections().then(s=>s.find(s=>s.id===${JSON.stringify(section.id)})?.title===${JSON.stringify(section.title)})`,
  );
  await wait(
    `!!document.querySelector('button[title^="다시 실행"]:not(:disabled)')`,
  );
  await shortcut('Y', ['control']);
  await wait(
    `window.gameCanvas.listSections().then(s=>s.find(s=>s.id===${JSON.stringify(section.id)})?.title==='한글 새 섹션')`,
  );
  await ready();
  console.log(
    'PASS: actual section rename double confirmation records once, preserves identity/membership and supports Undo/Redo',
  );
  // Personal section collapse must not change history or document persisted collapse.
  const beforeSection = await history(),
    states = (await call('listDocuments')).map((d) => [d.id, d.collapsed]);
  await click(`${sectionNode} button[title="섹션 최소화"]`);
  await wait(
    `!!document.querySelector(${JSON.stringify(sectionNode + ' .section-card--collapsed')})`,
  );
  assert.equal(await history(), beforeSection);
  assert.deepEqual(
    (await call('listDocuments')).map((d) => [d.id, d.collapsed]),
    states,
  );
  if (screenshot) await screenshot('section-collapsed');
  await shortcut('F', ['control']);
  await wait('!!document.querySelector(".canvas-find")');
  await wait(
    `!document.querySelector(${JSON.stringify(sectionNode + ' .section-card--collapsed')})`,
  );
  await click('button[title="찾기 닫기 (Esc)"]');
  await wait(
    `!!document.querySelector(${JSON.stringify(sectionNode + ' .section-card--collapsed')})`,
  );
  await click(`${sectionNode} button[title="섹션 펼치기"]`);
  await wait(
    `!document.querySelector(${JSON.stringify(sectionNode + ' .section-card--collapsed')})`,
  );
  assert.equal(await history(), beforeSection);
  console.log(
    'PASS: section collapse/expand and search reveal are personal views, retain member document state and add no history',
  );
  const memberKeys = new Set(section.members.flatMap((m) => [m.id, m.path]));
  const doc =
    originals.find(
      (d) => !memberKeys.has(d.id) && !memberKeys.has(d.relativePath),
    ) ?? originals[0];
  const documentNode = `[data-id="${doc.id}"]`;
  // Initial fixtures use expanded documents. A native file change must record once and keep expanded height.
  assert.equal(doc.collapsed, false);
  const beforeDocument = await history();
  await click(`${documentNode} button[title="메모 최소화"]`);
  await wait(
    `window.gameCanvas.listDocuments().then(d=>d.find(d=>d.id===${JSON.stringify(doc.id)})?.collapsed===true)`,
  );
  await ready();
  assert.equal(await history(), beforeDocument + 1);
  assert.equal(
    (await call('listDocuments')).find((d) => d.id === doc.id).height,
    doc.height,
  );
  await shortcut('Z', ['control']);
  await wait(
    `window.gameCanvas.listDocuments().then(d=>d.find(d=>d.id===${JSON.stringify(doc.id)})?.collapsed===false)`,
  );
  await wait(
    `!!document.querySelector('button[title^="다시 실행"]:not(:disabled)')`,
  );
  await shortcut('Y', ['control']);
  await wait(
    `window.gameCanvas.listDocuments().then(d=>d.find(d=>d.id===${JSON.stringify(doc.id)})?.collapsed===true)`,
  );
  await ready();
  await click(`${documentNode} button[title="메모 펼치기"]`);
  await wait(
    `window.gameCanvas.listDocuments().then(d=>d.find(d=>d.id===${JSON.stringify(doc.id)})?.collapsed===false)`,
  );
  await ready();
  console.log(
    'PASS: document header collapse/expand uses native persistence/history and Undo/Redo while preserving stored height',
  );
  const beforeMenu = await history();
  for (const [label, collapsed] of [
    ['최소화', true],
    ['펼치기', false],
  ]) {
    await js(
      `{const card=document.querySelector(${JSON.stringify(documentNode + ' .document-card')}),r=card.getBoundingClientRect();card.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.x+20,clientY:r.y+12}));}`,
    );
    await wait('!!document.querySelector("[data-ui-id=document-menu]")');
    await js(
      `Array.from(document.querySelectorAll('[data-ui-id=document-menu] button')).find(button=>button.textContent.includes(${JSON.stringify(label)})).click()`,
    );
    await wait('!document.querySelector("[data-ui-id=document-menu]")');
    await ready();
    assert.equal(
      (await call('listDocuments')).find((item) => item.id === doc.id)
        .collapsed,
      collapsed,
    );
  }
  assert.equal(await history(), beforeMenu + 2);
  console.log(
    'PASS: document context-menu minimize/expand uses the same command boundary and closes the originating menu',
  );
  const beforeAll = await history();
  await shortcut('A', ['control']);
  await wait(
    `document.querySelectorAll('.react-flow__node-document.selected').length===${originals.length}`,
  );
  await click('button[title="선택 항목 최소화 또는 펼치기 (Ctrl+Shift+M)"]');
  await wait(
    'window.gameCanvas.listDocuments().then(d=>d.every(d=>d.collapsed))',
  );
  await ready();
  assert.equal(await history(), beforeAll + originals.length);
  await shortcut('A', ['control']);
  await shortcut('M', ['control', 'shift']);
  await wait(
    'window.gameCanvas.listDocuments().then(d=>d.every(d=>!d.collapsed))',
  );
  await ready();
  assert.equal(await history(), beforeAll + originals.length * 2);
  for (const original of originals) {
    const current = (await call('listDocuments')).find(
      (d) => d.id === original.id,
    );
    assert.equal(current.body, original.body);
    assert.equal(current.height, original.height);
  }
  console.log(
    'PASS: selected document minimize/expand preserves sequential per-document history and original bodies/dimensions',
  );
  // Select documents, section and HTML together with an actual pane drag.
  await shortcut('1', ['shift']);
  await pause(350);
  const box = await js(
    `(()=>{const rects=[...document.querySelectorAll('.react-flow__node')].map(node=>node.getBoundingClientRect()).filter(r=>r.width&&r.height),start={x:Math.ceil(Math.max(...rects.map(r=>r.right)))+14,y:Math.floor(Math.min(...rects.map(r=>r.top)))-14},end={x:Math.floor(Math.min(...rects.map(r=>r.left)))-14,y:Math.ceil(Math.max(...rects.map(r=>r.bottom)))+14};for(const point of [start,end])if(!document.elementFromPoint(point.x,point.y)?.classList.contains('react-flow__pane'))throw Error('Mixed selection corner is obstructed');return {start,end};})()`,
  );
  await pointer('mouseDown', box.start);
  for (let n = 1; n <= 10; n++) {
    await pointer('mouseMove', {
      x: Math.round(box.start.x + ((box.end.x - box.start.x) * n) / 10),
      y: Math.round(box.start.y + ((box.end.y - box.start.y) * n) / 10),
    });
    await pause(20);
  }
  await pointer('mouseUp', box.end);
  await wait(
    'document.querySelectorAll(".react-flow__node-preview.selected").length>0 && document.querySelectorAll(".react-flow__node-section.selected").length>0',
  );
  const previews = await call('listPreviews'),
    priorWindows = await Promise.all(
      previews.map((item) => call('getPreviewWindow', item.relativePath)),
    );
  await shortcut('M', ['control', 'shift']);
  await wait(
    'window.gameCanvas.listDocuments().then(d=>d.every(d=>d.collapsed))',
  );
  await ready();
  await wait(
    `!!document.querySelector(${JSON.stringify(sectionNode + ' .section-card--collapsed')})`,
  );
  for (let n = 0; n < previews.length; n++) {
    const current = await call('getPreviewWindow', previews[n].relativePath);
    assert.equal(current.collapsed, true);
    if (priorWindows[n])
      for (const field of ['x', 'y', 'width', 'height', 'presetId', 'freeSize'])
        assert.deepEqual(current[field], priorWindows[n][field]);
    // Restore the isolated preview after verifying the real mixed command's persistence.
    await call(
      'savePreviewWindow',
      { ...current, collapsed: false },
      previews[n].relativePath,
    );
  }
  await click(`${sectionNode} button[title="섹션 펼치기"]`);
  await wait(
    `!document.querySelector(${JSON.stringify(sectionNode + ' .section-card--collapsed')})`,
  );
  await shortcut('A', ['control']);
  await shortcut('M', ['control', 'shift']);
  await wait(
    'window.gameCanvas.listDocuments().then(d=>d.every(d=>!d.collapsed))',
  );
  await ready();
  console.log(
    'PASS: actual mixed pane selection persists preview collapse/geometry alongside personal section and document collapse',
  );
  // The rename confirmation from an old canvas cannot survive another visit.
  await openRename();
  const sheets = await call('getCanvasSheets');
  await call('changeCanvasSheets', {
    action: 'add',
    id: 'presentation-other',
    name: '표시 경계 검사',
    expected: sheets.raw ?? null,
  });
  await wait(
    `Array.from(document.querySelectorAll('[role=tab]')).some(t=>t.textContent.includes('표시 경계 검사'))`,
  );
  await js(
    `Array.from(document.querySelectorAll('[role=tab]')).find(t=>t.textContent.includes('표시 경계 검사')).click()`,
  );
  await wait('!document.querySelector("[data-ui-id=section-rename]")');
  await js(
    `Array.from(document.querySelectorAll('[role=tab]')).find(t=>!t.textContent.includes('표시 경계 검사')).click()`,
  );
  await wait(`!!document.querySelector(${JSON.stringify(sectionNode)})`);
  assert.ok(
    !(await js('!!document.querySelector("[data-ui-id=section-rename]")')),
  );
  // Leave one stored personal collapse for restart verification.
  await click(`${sectionNode} button[title="섹션 최소화"]`);
  await wait(
    `!!document.querySelector(${JSON.stringify(sectionNode + ' .section-card--collapsed')})`,
  );
  console.log(
    'PASS: canvas round trip expires old rename confirmation and personal section collapse remains usable',
  );
  return {
    sectionId: section.id,
    sectionPath: section.relativePath,
    originals,
  };
}
