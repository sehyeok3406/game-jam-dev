import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
app.setPath('userData', path.resolve('out/drag-performance/profile'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function run() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 1000,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  const wait = async (code) => {
    for (let i = 0; i < 180; i++) {
      if (await js(code)) return;
      await sleep(100);
    }
    throw Error('Timeout: ' + code);
  };
  const pointer = (type, x, y) =>
    win.webContents.sendInputEvent({
      type,
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
  const results = [];
  try {
    for (const repeat of [1, 2, 3])
      for (const count of [20, 100, 300]) {
        await win.loadURL(process.env.QA_URL);
        await wait(
          '!!window.gameCanvas && !!document.querySelector(".home-project-open")',
        );
        await js(`(async()=>{
      const api=window.gameCanvas;
      const sample=(await api.listDocuments())[0];
      window.__probeDocs=Array.from({length:${count}},(_,i)=>({...sample,id:'probe-'+i,relativePath:'ideas/probe-'+i+'.md',identitySource:'frontmatter',title:'Probe '+i,x:(i%12)*380,y:Math.floor(i/12)*330,width:350,height:300,body:'## Sample document\\n\\n- first item\\n- second item\\n\\nSome **formatted** text and a longer paragraph for the drag performance probe.'}));
      api.listDocuments=async()=>structuredClone(window.__probeDocs);
      api.listSections=async()=>[]; api.listPreviews=async()=>[];
      window.__writes=[];
      for(const name of ['updateLayouts','updateDocumentLayout','updateSectionLayout'])api[name]=async(input)=>{window.__writes.push({name,count:Array.isArray(input)?input.length:1,input,time:performance.now()});if(Array.isArray(input))for(const update of input){const doc=window.__probeDocs.find(d=>d.relativePath===update.relativePath);Object.assign(doc,{x:update.x,y:update.y});}};
      document.querySelector('.home-project-open').click();
    })()`);
        await wait(
          `document.querySelectorAll('.react-flow__node-document').length===${count}`,
        );
        await sleep(1200);
        win.webContents.sendInputEvent({
          type: 'keyDown',
          keyCode: 'A',
          modifiers: ['control'],
        });
        win.webContents.sendInputEvent({
          type: 'keyUp',
          keyCode: 'A',
          modifiers: ['control'],
        });
        await wait(
          `document.querySelectorAll('.react-flow__node-document.selected').length===${count}`,
        );
        await sleep(250);
        const start = await js(
          `(()=>{for(const el of document.querySelectorAll('.document-card__header')){const r=el.getBoundingClientRect();for(let x=Math.ceil(r.left)+5;x<r.right-5;x+=5){const y=Math.round(r.top+r.height/2),hit=document.elementFromPoint(x,y);if(y>150&&y<850&&x>150&&x<1250&&hit?.closest('.document-card__header')===el&&!hit.closest('button,.nodrag'))return {x,y};}}throw Error('No drag handle');})()`,
        );
        const beforePositions = await js(
          'window.__probeDocs.map(d=>({x:d.x,y:d.y}))',
        );
        await js(
          `window.__dragCounts={card:0,markdown:0};window.__writes=[];window.__frames=[];window.__observe=true;window.__lastFrame=performance.now();requestAnimationFrame(function tick(t){if(!window.__observe)return;window.__frames.push(t-window.__lastFrame);window.__lastFrame=t;requestAnimationFrame(tick);});`,
        );
        pointer('mouseDown', start.x, start.y);
        for (let i = 1; i <= 24; i++) {
          pointer('mouseMove', start.x + i * 3, start.y + Math.round(i / 2));
          await sleep(25);
        }
        // Hold beyond the suggested five-second checkpoint to detect any existing timer.
        if (count === 20 && repeat === 1) await sleep(5200);
        const during = await js(
          `({counts:{...window.__dragCounts},writes:[...window.__writes],dragging:document.querySelectorAll('.react-flow__node.dragging').length,frames:window.__frames})`,
        );
        pointer('mouseUp', start.x + 72, start.y + 12);
        await sleep(700);
        await wait('window.__writes.length === 1');
        const after = await js(
          `window.__observe=false;({counts:window.__dragCounts,writes:window.__writes})`,
        );
        assert.equal(during.writes.length, 0, 'dragging never saves');
        assert.equal(after.writes.length, 1, 'drop saves one batch');
        assert.equal(after.writes[0].count, count);
        const moved = after.writes[0].input;
        const dx = moved[0].x - beforePositions[0].x,
          dy = moved[0].y - beforePositions[0].y;
        assert.ok(
          Math.abs(dx) + Math.abs(dy) > 1,
          'the gesture actually moved the selection',
        );
        for (let i = 0; i < count; i++) {
          assert.ok(Math.abs(moved[i].x - beforePositions[i].x - dx) < 0.01);
          assert.ok(Math.abs(moved[i].y - beforePositions[i].y - dy) < 0.01);
        }
        if (process.env.DRAG_BASELINE === '1')
          assert.ok(
            during.counts.markdown > 0,
            'baseline instrumentation must observe Markdown renders',
          );
        if (process.env.DRAG_BASELINE !== '1')
          assert.equal(
            during.counts.markdown,
            0,
            'pure position updates must not render Markdown',
          );
        delete after.writes[0].input;
        const frames = during.frames.filter((n) => n > 0).sort((a, b) => a - b);
        results.push({
          count,
          repeat,
          variant: process.env.DRAG_BASELINE === '1' ? 'baseline' : 'optimized',
          during: {
            counts: during.counts,
            writes: during.writes,
            dragging: during.dragging,
          },
          after,
          frameMs: {
            p50: frames[Math.floor(frames.length * 0.5)],
            p95: frames[Math.floor(frames.length * 0.95)],
            max: frames.at(-1),
            samples: frames.length,
          },
        });
        console.log(JSON.stringify(results.at(-1)));
      }
    await fs.writeFile(
      `out/drag-performance/${process.env.DRAG_BASELINE === '1' ? 'baseline' : 'optimized'}.json`,
      JSON.stringify(results, null, 2),
    );
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    win.destroy();
    app.exit(1);
  }
}
run().catch((error) => {
  console.error(error);
  app.exit(1);
});
