import assert from 'node:assert/strict';

export async function cardPropertiesScenarios({
  js,
  wait,
  click,
  key,
  insertText,
  reload,
  screenshot,
}) {
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const initial = (await js('window.gameCanvas.listDocuments()'))[0];
  const id = initial.id,
    doc = `[data-find-document="${id}"]`;
  const preference = await js(
    `(async()=>{const key='file-property-views:'+(await window.gameCanvas.getWorkspace()).root;localStorage.setItem(key,JSON.stringify({version:1,files:{[${JSON.stringify(id)}]:{status:true,createdBy:true,createdAt:true,lastEditedBy:true,lastEditedAt:true}}}));return key;})()`,
  );
  await reload();
  await wait('!!document.querySelector(".home-project-open")');
  await js('document.querySelector(".home-project-open").click()');
  await wait(`!!document.querySelector('${doc} .document-card__content')`);
  const title = '중복 제목 검사';
  const body =
    '# 중복 제목 검사\n\n첫 번째 문단입니다.\n\n둘째 문단입니다.\n\n- [ ] 원문 체크박스\n';
  await js(
    `(async()=>{const d=(await window.gameCanvas.listDocuments()).find(d=>d.id===${JSON.stringify(id)});await window.gameCanvas.saveDocument({relativePath:d.relativePath,revision:d.revision,title:${JSON.stringify(title)},body:${JSON.stringify(body)}});})()`,
  );
  await wait(
    `document.querySelector('${doc} .document-card__title')?.textContent.trim()===${JSON.stringify(title)}`,
  );
  assert.equal(
    await js(`document.querySelector('${doc} .markdown-body h1')===null`),
    true,
  );
  assert.equal(
    await js(
      `document.querySelectorAll('${doc} .file-property-badge,${doc} .file-property-more').length`,
    ),
    0,
  );
  assert.equal(
    (await js('window.gameCanvas.listDocuments()')).find((d) => d.id === id)
      .body,
    body,
  );
  await key('f', ['control']);
  await wait('!!document.querySelector(".canvas-find input")');
  await insertText(title);
  await wait(
    `document.querySelector('.canvas-find [aria-live]')?.textContent==='1 / 1'`,
  );
  await click('.canvas-find [title="찾기 닫기 (Esc)"]');
  await js(
    `document.querySelector('${doc} .document-card__header [title="문서 상세 정보"]').click()`,
  );
  await wait(
    '!!document.querySelector(".file-properties-editor [data-property=type]")',
  );
  const text = (selector) =>
    js(
      `document.querySelector(${JSON.stringify(selector)})?.textContent.trim()`,
    );
  assert.equal(
    await text(
      '.file-properties-editor [data-property=type] .file-property-value',
    ),
    '아이디어',
  );
  assert.equal(
    await text(
      '.file-properties-editor [data-property=phase] .file-property-value',
    ),
    '메모',
  );
  assert.equal(
    await js('document.querySelectorAll(".object-inspector dl dt").length>0'),
    true,
  );
  assert.equal(
    await js(
      '[...document.querySelectorAll(".object-inspector dl dt")].some(e=>e.textContent==="문서 유형"||e.textContent==="최근 변경")',
    ),
    false,
  );
  assert.equal(
    await js(
      'document.querySelectorAll(".file-properties-editor input[type=checkbox]").length',
    ),
    2,
  );
  assert.equal(
    await js(
      'document.querySelectorAll(".file-properties-editor .file-property-value").length',
    ),
    6,
  );
  await js(
    `(()=>{const s=document.querySelector('[aria-label="파일 상태 속성 값"]');s.value='done';s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await wait(
    `window.gameCanvas.listDocuments().then(ds=>ds.find(d=>d.id===${JSON.stringify(id)}).workflowStatusId==='done')`,
  );
  await click('[aria-label="상태 속성 적용"]');
  await wait(
    `window.gameCanvas.listDocuments().then(ds=>ds.find(d=>d.id===${JSON.stringify(id)}).statusPropertyEnabled===false)`,
  );
  assert.equal(
    await js(
      'document.querySelector(".file-property-row--status select").disabled',
    ),
    true,
  );
  await click('[aria-label="상태 속성 적용"]');
  await wait(
    '!document.querySelector(".file-property-row--status select").disabled',
  );
  assert.equal(
    await js(
      'document.querySelector(".file-property-row--status select").value',
    ),
    'done',
  );
  await click('[aria-label="상태 우측 상단 표시"]');
  await wait(`!document.querySelector('${doc} .workflow-badge')`);
  const savedPrefs = await js(
    `JSON.parse(localStorage.getItem(${JSON.stringify(preference)}))`,
  );
  assert.equal(savedPrefs.files[id].status, false);
  for (const key of ['createdBy', 'createdAt', 'lastEditedBy', 'lastEditedAt'])
    assert.equal(savedPrefs.files[id][key], true);
  await screenshot('md-properties');
  await js(
    'document.querySelector(".preview-card .preview-card__actions > button:last-child").click()',
  );
  await wait(
    `document.querySelector('.file-properties-editor [data-property=type] .file-property-value')?.textContent==='HTML'`,
  );
  assert.equal(
    await js(
      'document.querySelector(".file-properties-editor [data-property=phase]")===null',
    ),
    true,
  );
  await screenshot('html-properties');
  // Clicking the second reading paragraph must not edit the H1 that reappears.
  await click(`${doc} .markdown-body [data-document-block="2"]`);
  await wait(
    'document.activeElement?.getAttribute("aria-label")==="문서 내용"',
  );
  assert.equal(await text(`${doc} .document-editor .tiptap h1`), title);
  await insertText('【커서검증】');
  await key('s', ['control']);
  await wait(
    `window.gameCanvas.listDocuments().then(ds=>ds.find(d=>d.id===${JSON.stringify(id)}).body.includes('【커서검증】'))`,
  );
  const edited = (await js('window.gameCanvas.listDocuments()')).find(
    (d) => d.id === id,
  ).body;
  assert.ok(edited.startsWith('# ' + title));
  assert.ok(edited.split(/\n\s*\n/)[2].includes('【커서검증】'), edited);
  await js(`document.querySelector('[aria-label="더 보기"]').click()`);
  await js(
    `[...document.querySelectorAll('button')].find(e=>e.textContent==='Markdown 원문 보기').click()`,
  );
  await wait('!!document.querySelector(".document-editor textarea")');
  assert.ok(
    await js(
      `document.querySelector('[aria-label="Markdown 내용"]').value.startsWith(${JSON.stringify('# ' + title)})`,
    ),
  );
  await key('Enter', ['control']);
  await wait(`!!document.querySelector('${doc} .document-card__content')`);
  assert.equal(
    await js(`document.querySelector('${doc} .markdown-body h1')===null`),
    true,
  );
  const before = (await js('window.gameCanvas.listDocuments()')).find(
    (d) => d.id === id,
  ).body;
  await key('f', ['control']);
  await wait('!!document.querySelector(".canvas-find input")');
  await insertText(title);
  await wait(
    `document.querySelector('.canvas-find [aria-live]')?.textContent==='1 / 1'`,
  );
  await key('Enter');
  await click('.canvas-find [title="찾기 닫기 (Esc)"]');
  await pause(400);
  await wait(
    `(()=>{const e=document.querySelector('${doc} .markdown-body input[type=checkbox]');return e&&!e.disabled&&e.getBoundingClientRect().left>8;})()`,
  );
  await click(`${doc} .markdown-body input[type=checkbox]`);
  await wait(
    `window.gameCanvas.listDocuments().then(ds=>ds.find(d=>d.id===${JSON.stringify(id)}).body.includes('[x]'))`,
  );
  assert.equal(
    (await js('window.gameCanvas.listDocuments()')).find((d) => d.id === id)
      .body,
    before.replace('[ ]', '[x]'),
  );
  await pause(120);
  await screenshot('duplicate-title-reading');
  console.log(
    'PASS: MD/HTML properties, separate type/phase/status, workflow apply/value preservation, legacy display preference retention, duplicate H1 reading/search, original editing/source, paragraph caret and original checkbox offsets.',
  );
}
