import assert from 'node:assert/strict';

export async function assertCanvasToolbar(js) {
  const layout = await js(`(()=>{
    const bar=document.querySelector('.bottom-toolbar'), canvas=document.querySelector('.canvas-shell');
    const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    const targets=[...bar.querySelectorAll(':scope > button, :scope > details > summary')].map(e=>{
      const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return {name:e.textContent.trim(),visible:r.width>=36&&r.height>=36,clickable:e===hit||e.contains(hit)};
    });
    return {bar:rect(bar),canvas:rect(canvas),targets,map:document.querySelector('.canvas-minimap-panel')?rect(document.querySelector('.canvas-minimap-panel')):null};
  })()`);
  assert.equal(
    layout.targets.length,
    6,
    'One toolbar contains the six primary tool groups',
  );
  assert.ok(
    layout.bar.height <= 60 && layout.bar.width > layout.bar.height * 3,
    'Toolbar stays thin and horizontal',
  );
  assert.ok(
    Math.abs(
      (layout.bar.left +
        layout.bar.right -
        layout.canvas.left -
        layout.canvas.right) /
        2,
    ) < 2,
    'Toolbar is centered in the usable canvas',
  );
  assert.ok(
    layout.bar.left >= layout.canvas.left &&
      layout.bar.right <= layout.canvas.right,
    'Toolbar stays outside side panels',
  );
  assert.ok(
    layout.bar.bottom <= layout.canvas.bottom - 8,
    'Toolbar clears the footer',
  );
  for (const target of layout.targets)
    assert.ok(target.visible && target.clickable, JSON.stringify(target));
  if (layout.map) {
    const a = layout.bar,
      b = layout.map;
    assert.ok(
      a.right <= b.left ||
        a.left >= b.right ||
        a.bottom <= b.top ||
        a.top >= b.bottom,
      'Minimap never covers the toolbar',
    );
  }
}
