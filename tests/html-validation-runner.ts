import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { app } from 'electron';
import { validateHtml } from '../src/html-validation';

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
