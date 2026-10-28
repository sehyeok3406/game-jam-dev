import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { validateHtml } from '../src/html-validation';

app.setPath(
  'userData',
  mkdtempSync(path.join(os.tmpdir(), 'gamejam-html-validation-')),
);
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  try {
    await validateHtml(
      '<!doctype html><html><body><button>play</button><script>document.body.dataset.ready="yes";</script></body></html>',
    );
    console.log('PASS: valid HTML loads');
    for (const source of [
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA',
    ]) {
      await validateHtml(
        `<html><body><img src="${source}" onerror="throw new Error('image decode failed')"><script>setTimeout(()=>{if(!document.querySelector('img').naturalWidth)throw new Error('image did not load')},100)</script></body></html>`,
      );
    }
    console.log(
      'PASS: embedded GIF and WebP decode in the actual sandboxed renderer',
    );
    await validateHtml(
      '<!doctype html><html><title>implicit body</title><style>canvas{background:green}</style><main><canvas></canvas><button>play</button></main><script>document.querySelector("button").dataset.ready="yes";</script>',
    );
    console.log('PASS: browser-valid implicit body and head load');
    await assert.rejects(
      validateHtml(
        '<html><title>implicit runtime error</title><main>play</main><script>throw new Error("implicit body failure");</script>',
      ),
      (error: any) =>
        error.code === 'GC-HTML-002' &&
        error.message.includes('implicit body failure'),
    );
    console.log('PASS: implicit-body runtime errors remain instrumented');
    await assert.rejects(
      validateHtml(
        '<html><body><script>throw new Error("fixture runtime failure");</script></body></html>',
      ),
      /fixture runtime failure/,
    );
    console.log('PASS: runtime error is rejected');
    await assert.rejects(
      validateHtml('<html><body><script>const =;</script></body></html>'),
      /HTML 초기 실행 오류/,
    );
    console.log('PASS: syntax error is rejected');
    await assert.rejects(
      validateHtml(
        '<html><body><script>Promise.reject("fixture rejection");</script></body></html>',
      ),
      /fixture rejection/,
    );
    console.log('PASS: rejected promise is rejected');
    const resizeFixture = (script: string) =>
      `<html><body><div id="box" style="width:100px;height:100px"></div><script>
      const box=document.getElementById('box');let count=0;
      new ResizeObserver(()=>{${script}}).observe(box);
      </script></body></html>`;
    await validateHtml(
      resizeFixture('if(++count<3)box.style.width=(100+count)+"px";'),
    );
    console.log(
      'PASS: native resize-delivery notices may settle across frames',
    );
    await assert.rejects(
      validateHtml(resizeFixture('box.style.width=(100+(++count))+"px";')),
      /ResizeObserver 크기 변경이 반복/,
    );
    console.log('PASS: persistent native resize loops remain fatal');
    await assert.rejects(
      validateHtml(
        resizeFixture(
          'if(++count===1){box.style.width="101px";setTimeout(()=>{throw new Error("failure after resize notice")},100);}',
        ),
      ),
      /failure after resize notice/,
    );
    console.log('PASS: real runtime errors after resize notices remain fatal');
    for (const script of [
      'throw new Error("ResizeObserver loop completed with undelivered notifications.");',
      'throw "ResizeObserver loop completed with undelivered notifications.";',
      'dispatchEvent(new ErrorEvent("error",{message:"ResizeObserver loop completed with undelivered notifications."}));',
      'console.error("ResizeObserver loop completed with undelivered notifications.");',
      'Promise.reject("ResizeObserver loop completed with undelivered notifications.");',
    ]) {
      await assert.rejects(
        validateHtml(`<html><body><script>${script}</script></body></html>`),
        /HTML 초기 실행 오류/,
      );
    }
    console.log(
      'PASS: matching script exceptions, console errors and rejections remain fatal',
    );
    if (process.argv[2]) {
      await validateHtml(
        await fs.readFile(process.argv[2], 'utf8'),
        'saved-failed-candidate.html',
      );
      console.log(
        'PASS: saved failed candidate parses and initially runs in an isolated renderer',
      );
    }
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
