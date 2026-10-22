import assert from 'node:assert/strict';

/** Real UI sequence shared by the preview fixture and packaged native IPC. */
export async function sectionUiScenarios({
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
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const shortcut = async (name, modifiers = []) => {
    if (name === 'Z' || name === 'Y')
      await wait(
        `!!document.querySelector('button[title^="${name === 'Z' ? '실행 취소' : '다시 실행'}"]:not(:disabled)')`,
      );
    await js('document.activeElement?.blur()');
    await key(name, modifiers);
  };
  const click = async (selector) => {
    await wait(
      `!!document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`,
    );
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  const history = async () => (await call('listHistory')).length;
  // Both runtimes use temporary data. Remove demo groups, retaining their documents.
  for (const section of await call('listSections'))
    await call('deleteSection', {
      sectionId: section.id,
      relativePath: section.relativePath,
      revision: section.revision,
      deleteMembers: false,
    });
  const originals = await call('listDocuments');
  assert.ok(originals.length >= 3);
  await wait(
    `document.querySelectorAll('.react-flow__node-document').length===${originals.length}`,
  );
  await shortcut('A', ['control']);
  await wait(
    `document.querySelectorAll('.react-flow__node-document.selected').length===${originals.length}`,
  );
  await click('button[title^="선택한 파일을 하나의 섹션"]');
  await wait('!!document.querySelector("[data-ui-id=section-create]")');
  const beforeCreate = await history();
  // A fast repeated activation must publish one section command.
  await js(
    `{const b=document.querySelector('[data-ui-id=section-create] .button-primary');b.click();b.click();}`,
  );
  await wait('!document.querySelector("[data-ui-id=section-create]")');
  const grouped = (await call('listSections'))[0];
  assert.equal((await call('listSections')).length, 1);
  assert.equal(grouped.members.length, originals.length);
  assert.equal(await history(), beforeCreate + 1);
  await wait(
    `!!document.querySelector('[data-id="section:${grouped.id}"].selected')`,
  );
  console.log(
    'PASS: actual section creation snapshots members, records once on double activation and selects the created node',
  );
  async function sectionMenu(section, label) {
    await wait(
      `!!document.querySelector('button[title^="실행 취소"]:not(:disabled)')`,
    );
    const selector = `[data-id="section:${section.id}"] .section-card__header`;
    await wait(`!!document.querySelector(${JSON.stringify(selector)})`);
    await js(
      `{const n=document.querySelector(${JSON.stringify(selector)}),r=n.getBoundingClientRect();n.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.x+30,clientY:r.y+15}));}`,
    );
    await wait('!!document.querySelector("[data-ui-id=section-menu]")');
    await js(
      `Array.from(document.querySelectorAll('[data-ui-id=section-menu] button')).find(b=>b.textContent.includes(${JSON.stringify(label)})).click()`,
    );
    await wait('!!document.querySelector("[data-ui-id=section-action]")');
  }
  await sectionMenu(grouped, '섹션 해제');
  const beforeDismiss = await history();
  await key('Tab', ['shift']);
  assert.ok(
    await js(
      '!!document.activeElement?.closest("[data-ui-id=section-action]")',
    ),
  );
  await key('Escape');
  await wait('!document.querySelector("[data-ui-id=section-action]")');
  assert.equal(await history(), beforeDismiss);
  assert.equal((await call('listSections')).length, 1);
  await sectionMenu(grouped, '섹션 해제');
  if (screenshot) await screenshot('ungroup');
  const beforeUngroup = await history();
  await js(
    `{const b=document.querySelector('[data-ui-id=section-action] .button-primary');b.click();b.click();}`,
  );
  await wait('window.gameCanvas.listSections().then(s=>s.length===0)');
  await wait('!document.querySelector("[data-ui-id=section-action]")');
  await wait(
    `!!document.querySelector('button[title^="실행 취소"]:not(:disabled)')`,
  );
  assert.equal((await call('listDocuments')).length, originals.length);
  assert.equal(await history(), beforeUngroup + 1);
  await shortcut('Z', ['control']);
  await wait(
    `window.gameCanvas.listSections().then(s=>s.some(s=>s.id===${JSON.stringify(grouped.id)}))`,
  );
  await shortcut('Y', ['control']);
  await wait('window.gameCanvas.listSections().then(s=>s.length===0)');
  await shortcut('Z', ['control']);
  await wait('window.gameCanvas.listSections().then(s=>s.length===1)');
  await sectionMenu((await call('listSections'))[0], '섹션과 파일 삭제');
  const beforeDelete = await history();
  await js(
    `{const b=document.querySelector('[data-ui-id=section-action] .button-danger');b.click();b.click();}`,
  );
  await wait('window.gameCanvas.listDocuments().then(d=>d.length===0)');
  await wait('!document.querySelector("[data-ui-id=section-action]")');
  await wait(
    `!!document.querySelector('button[title^="실행 취소"]:not(:disabled)')`,
  );
  assert.equal((await call('listSections')).length, 0);
  assert.equal(await history(), beforeDelete + 1);
  await shortcut('Z', ['control']);
  await wait(
    `window.gameCanvas.listDocuments().then(d=>d.length===${originals.length})`,
  );
  for (const original of originals) {
    const restored = (await call('listDocuments')).find(
      (d) => d.id === original.id,
    );
    assert.equal(restored.body, original.body);
    assert.equal(restored.relativePath, original.relativePath);
  }
  console.log(
    'PASS: actual ungroup and section/member trash record once, retain native semantics and Undo/Redo restore original document bodies',
  );
  await sectionMenu((await call('listSections'))[0], '섹션 해제');
  await click('[data-ui-id=section-action] .button-primary');
  await wait('window.gameCanvas.listSections().then(s=>s.length===0)');
  // Native creation requires members. Use the two other fixture documents as target seeds.
  // All changes to the tested document below use actual drag/confirmation.
  const doc =
    originals.find((d) => d.relativePath.startsWith('docs/')) ?? originals[0];
  const base = {
    canvasId: 'default',
    x: doc.x + doc.width + 180,
    // Keep target headers clear of the fixture's live HTML preview window.
    y: doc.y + 1000,
    width: 500,
    height: 500,
    members: [],
  };
  const otherDocuments = originals.filter((item) => item.id !== doc.id);
  const member = (item) => ({ id: item.id, path: item.relativePath });
  const first = await call('createSection', {
    ...base,
    title: '첫 대상',
    members: [member(otherDocuments[0])],
  });
  const second = await call('createSection', {
    ...base,
    x: base.x + 600,
    title: '둘째 대상',
    members: [member(otherDocuments[1])],
  });
  async function dragTo(x, y) {
    await wait(
      `!!document.querySelector('button[title^="실행 취소"]:not(:disabled)')`,
    );
    await shortcut('1', ['shift']);
    await pause(400);
    const geometry = await js(
      `(()=>{const n=document.querySelector('[data-id="'+${JSON.stringify(doc.id)}+'"] .document-card__header'),r=n.getBoundingClientRect(),s=document.querySelector('[data-id="section:${first.id}"]').getBoundingClientRect();return {x:r.x+Math.min(60,r.width/3),y:r.y+Math.min(16,r.height/2),width:r.width,scale:s.width/500};})()`,
    );
    const current = (await call('listDocuments')).find((d) => d.id === doc.id);
    const end = {
      x: geometry.x + (x - (current.x + current.width / 2)) * geometry.scale,
      y:
        geometry.y +
        (y - (current.y + (current.collapsed ? 38 : current.height) / 2)) *
          geometry.scale,
    };
    await pointer('mouseDown', {
      x: Math.round(geometry.x),
      y: Math.round(geometry.y),
    });
    for (let n = 1; n <= 12; n++) {
      await pointer('mouseMove', {
        x: Math.round(geometry.x + ((end.x - geometry.x) * n) / 12),
        y: Math.round(geometry.y + ((end.y - geometry.y) * n) / 12),
      });
      await pause(20);
    }
    await pointer('mouseUp', { x: Math.round(end.x), y: Math.round(end.y) });
    try {
      await wait('!!document.querySelector("[data-ui-id=membership]")');
    } catch (error) {
      console.error('Drag diagnostic', {
        current,
        geometry,
        end,
        target: { x, y },
        documents: await call('listDocuments'),
        sections: await call('listSections'),
      });
      if (screenshot) await screenshot('drag-failure');
      throw error;
    }
  }
  const beforeCancel = await history();
  await dragTo(first.x + 250, first.y + 250);
  if (screenshot) await screenshot('membership');
  await key('Escape');
  await wait('!document.querySelector("[data-ui-id=membership]")');
  assert.equal(await history(), beforeCancel);
  assert.ok(
    !(await call('listSections')).some((s) =>
      s.members.some((m) => m.id === doc.id),
    ),
  );
  assert.equal(
    (await call('listDocuments')).find((d) => d.id === doc.id).x,
    doc.x,
  );
  async function acceptMembership() {
    const before = await history();
    await wait(
      '!!document.querySelector("[data-ui-id=membership] .button-primary:not(:disabled)")',
    );
    await js(
      `{const b=document.querySelector('[data-ui-id=membership] .button-primary');if(b.disabled)throw Error('Membership button became busy before click');b.click();b.click();}`,
    );
    try {
      await wait('!document.querySelector("[data-ui-id=membership]")');
    } catch (error) {
      console.error('Membership receipt diagnostic', {
        sections: (await call('listSections')).map((s) => ({
          id: s.id,
          title: s.title,
          members: s.members,
        })),
        document: (await call('listDocuments')).find((d) => d.id === doc.id),
        historyBefore: before,
        historyAfter: await history(),
        workspace: await call('getWorkspace'),
      });
      if (screenshot) await screenshot('receipt-failure');
      throw error;
    }
    assert.equal(await history(), before + 1);
  }
  await dragTo(first.x + 250, first.y + 250);
  await acceptMembership();
  assert.ok(
    (await call('listSections'))
      .find((s) => s.id === first.id)
      .members.some((m) => m.id === doc.id),
  );
  await dragTo(second.x + 250, second.y + 250);
  await acceptMembership();
  assert.ok(
    (await call('listSections'))
      .find((s) => s.id === second.id)
      .members.some((m) => m.id === doc.id),
  );
  await dragTo(doc.x + doc.width / 2, doc.y + doc.height / 2);
  await acceptMembership();
  assert.ok(
    !(await call('listSections')).some((s) =>
      s.members.some((m) => m.id === doc.id),
    ),
  );
  await shortcut('Z', ['control']);
  await wait(
    `window.gameCanvas.listSections().then(s=>s.find(s=>s.id===${JSON.stringify(second.id)})?.members.some(m=>m.id===${JSON.stringify(doc.id)}))`,
  );
  console.log(
    'PASS: native pointer membership cancel/add/transfer/remove and double confirmation preserve coordinates, single history and Undo',
  );
  // Open a destructive prompt, switch canvas and return: it must not authorize that new visit.
  await sectionMenu(
    (await call('listSections')).find((s) => s.id === second.id),
    '섹션과 파일 삭제',
  );
  const sheets = await call('getCanvasSheets');
  await call('changeCanvasSheets', {
    action: 'add',
    id: 'sections-other',
    name: '섹션 경계 검사',
    expected: sheets.raw ?? null,
  });
  await wait(
    `Array.from(document.querySelectorAll('[role=tab]')).some(t=>t.textContent.includes('섹션 경계 검사'))`,
  );
  await js(
    `Array.from(document.querySelectorAll('[role=tab]')).find(t=>t.textContent.includes('섹션 경계 검사')).click()`,
  );
  await wait('!document.querySelector("[data-ui-id=section-action]")');
  await js(
    `Array.from(document.querySelectorAll('[role=tab]')).find(t=>!t.textContent.includes('섹션 경계 검사')).click()`,
  );
  await wait(
    'document.querySelectorAll(".react-flow__node-document").length>0',
  );
  assert.ok(
    !(await js('!!document.querySelector("[data-ui-id=section-action]")')),
  );
  console.log(
    'PASS: actual canvas round trip expires section deletion confirmation',
  );
  return { originals, documentId: doc.id, sectionId: second.id };
}
