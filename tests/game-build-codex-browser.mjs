// Play real generated games through browser inputs; no state mutation or paid AI call.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { catPng, forestPng } from './helpers/game-build-qa-fixtures.mjs';
const scenario = process.argv[2] ?? 'pixel',
  expectedLives = Number(process.argv[3] ?? (scenario === 'pixel' ? 3 : 5));
assert.ok(['pixel', 'edit', 'reimport', 'neon'].includes(scenario));
const output = path.resolve('out/game-build-stage7', scenario),
  html = path.join(output, 'export.html');
await fs.access(html);
const parent = await fs.realpath(os.tmpdir()),
  root = await fs.mkdtemp(path.join(parent, 'gamejam-codex-browser-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const evidence = [];
try {
  for (const [browser, exe] of [
    ['Chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe'],
    ['Edge', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'],
  ]) {
    const profile = path.join(root, browser);
    await fs.mkdir(profile);
    const child = spawn(
      exe,
      [
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-component-update',
        '--enable-unsafe-swiftshader',
        `--user-data-dir=${profile}`,
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=0',
        'about:blank',
      ],
      { windowsHide: true, stdio: 'ignore' },
    );
    let ws, send, evaluate;
    const errors = [],
      network = [];
    const result = {
      browser,
      scenario,
      status: 'running',
      expectedLives: scenario === 'neon' ? undefined : expectedLives,
    };
    try {
      let port;
      for (let n = 0; n < 100; n++) {
        try {
          port = Number(
            (
              await fs.readFile(
                path.join(profile, 'DevToolsActivePort'),
                'utf8',
              )
            ).split('\n')[0],
          );
          break;
        } catch {}
        await pause(100);
      }
      assert.ok(port, browser + ' startup');
      const target = (
        await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
      ).find((t) => t.type === 'page');
      ws = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((r, j) => {
        ws.addEventListener('open', r, { once: true });
        ws.addEventListener('error', j, { once: true });
      });
      let sequence = 0;
      const pending = new Map();
      ws.addEventListener('message', ({ data }) => {
        const m = JSON.parse(String(data));
        if (m.id) {
          const p = pending.get(m.id);
          if (p) {
            pending.delete(m.id);
            if (m.error) p.reject(Error(JSON.stringify(m.error)));
            else p.resolve(m.result);
          }
        } else if (m.method === 'Runtime.exceptionThrown')
          errors.push(
            m.params.exceptionDetails.exception?.description ??
              m.params.exceptionDetails.text,
          );
        else if (
          m.method === 'Runtime.consoleAPICalled' &&
          m.params.type === 'error'
        )
          errors.push(m.params.args.map((a) => a.value).join(' '));
        else if (
          m.method === 'Network.requestWillBeSent' &&
          !/^(file|data|blob|about):/.test(m.params.request.url)
        )
          network.push(m.params.request.url);
      });
      send = (method, params = {}) =>
        new Promise((resolve, reject) => {
          const id = ++sequence;
          pending.set(id, { resolve, reject });
          ws.send(JSON.stringify({ id, method, params }));
        });
      evaluate = async (expression) => {
        const r = await send('Runtime.evaluate', {
          expression,
          returnByValue: true,
          awaitPromise: true,
        });
        if (r.exceptionDetails)
          throw Error(
            r.exceptionDetails.exception?.description ??
              r.exceptionDetails.text,
          );
        return r.result.value;
      };
      await send('Runtime.enable');
      await send('Network.enable');
      await send('Page.enable');
      await send('Page.addScriptToEvaluateOnNewDocument', {
        source: `window.qaDrawnImages=[];const originalDrawImage=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(image,...args){if(typeof image?.src==='string'&&!window.qaDrawnImages.includes(image.src))window.qaDrawnImages.push(image.src);return originalDrawImage.call(this,image,...args);};`,
      });
      await send('Emulation.setDeviceMetricsOverride', {
        width: 1100,
        height: 780,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await send('Page.navigate', { url: pathToFileURL(html).href });
      for (let n = 0; n < 100; n++) {
        if (
          await evaluate(
            "document.readyState==='complete'&&!!document.querySelector('canvas')",
          )
        )
          break;
        await pause(100);
      }
      await pause(500);
      const key = async (value) => {
        const virtual = {
          Enter: 13,
          ArrowLeft: 37,
          ArrowUp: 38,
          ArrowRight: 39,
          ArrowDown: 40,
          r: 82,
          1: 49,
          3: 51,
        }[value];
        const code =
          value === 'r' ? 'KeyR' : /^\d$/.test(value) ? 'Digit' + value : value;
        for (const type of ['keyDown', 'keyUp'])
          await send('Input.dispatchKeyEvent', {
            type,
            key: value,
            code,
            windowsVirtualKeyCode: virtual,
          });
        await pause(160);
      };
      const text = () => evaluate('document.body.innerText');
      const shot = async (suffix) => {
        const s = await send('Page.captureScreenshot', { format: 'png' });
        await fs.writeFile(
          path.join(output, `${browser.toLowerCase()}-${suffix}.png`),
          Buffer.from(s.data, 'base64'),
        );
      };
      const visibleLives = async (count) => {
        const line =
          (await text()).split('\n').find((s) => s.trim().startsWith('목숨')) ??
          '';
        if (/[♥♡]/.test(line))
          assert.equal((line.match(/♥/g) ?? []).length, count, line);
        else
          assert.match(
            line,
            new RegExp('목숨[^0-9]{0,15}' + count + '(?![0-9])'),
          );
      };
      result.initialText = await text();
      await shot('menu');
      await key('Enter');
      result.initialViewport = await evaluate(
        '({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight})',
      );
      if (scenario === 'reimport') {
        result.viewportChecks = [];
        for (const [width, height] of [
          [1100, 780],
          [720, 520],
        ]) {
          await send('Emulation.setDeviceMetricsOverride', {
            width,
            height,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await pause(250);
          const layout = await evaluate(
            "(()=>{const b=document.querySelector('canvas').getBoundingClientRect();return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,canvas:{left:b.left,top:b.top,right:b.right,bottom:b.bottom},buttons:[...document.querySelectorAll('button')].filter(e=>e.offsetWidth&&e.offsetHeight).map(e=>{const r=e.getBoundingClientRect();return {text:e.textContent,left:r.left,top:r.top,right:r.right,bottom:r.bottom};})}})()",
          );
          assert.ok(
            layout.scrollWidth <= width + 2 &&
              layout.scrollHeight <= height + 2,
            JSON.stringify(layout),
          );
          assert.ok(
            layout.canvas.left >= -1 &&
              layout.canvas.top >= -1 &&
              layout.canvas.right <= width + 1 &&
              layout.canvas.bottom <= height + 1,
            JSON.stringify(layout),
          );
          assert.ok(
            layout.buttons.every(
              (b) =>
                b.left >= -1 &&
                b.top >= -1 &&
                b.right <= width + 1 &&
                b.bottom <= height + 1,
            ),
            JSON.stringify(layout),
          );
          result.viewportChecks.push(layout);
          await shot('viewport-' + width);
        }
        await send('Emulation.setDeviceMetricsOverride', {
          width: 1100,
          height: 780,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await pause(150);
      }
      if (scenario === 'neon') {
        await shot('playing');
        await key('1');
        await key('3');
        result.winText = await text();
        assert.match(result.winText, /신호 연결 완료/);
        await shot('win');
        await key('r');
        result.resetText = await text();
        assert.doesNotMatch(result.resetText, /신호 연결 완료/);
        result.webgl = await evaluate(
          "(()=>{const c=document.querySelector('canvas'),g=c.getContext('webgl2')||c.getContext('webgl');return g?{version:g.getParameter(g.VERSION),width:c.width,height:c.height}:null})()",
        );
        assert.ok(result.webgl && result.webgl.width > 0);
        result.actions = ['Enter', '1', '3', 'win', 'R', 'reset'];
      } else {
        await visibleLives(expectedLives);
        await shot('playing');
        await key('ArrowDown');
        await visibleLives(expectedLives - 1);
        await key('ArrowUp');
        await key('ArrowDown');
        await visibleLives(expectedLives - 1);
        await key('ArrowUp');
        result.invulnerability =
          'second water touch within 1 second preserves lives';
        if (scenario === 'pixel') {
          for (let life = expectedLives - 2; life >= 0; life--) {
            await pause(1100);
            await key('ArrowDown');
            await visibleLives(life);
            if (life > 0) await key('ArrowUp');
          }
          result.loseText = await text();
          assert.match(result.loseText, /실패|게임 오버|배달 중단|다시 도전/);
          await shot('lose');
        }
        await key('r');
        await key('Enter');
        await visibleLives(expectedLives);
        for (const k of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowRight'])
          await key(k);
        result.winText = await text();
        assert.match(result.winText, /배달 완료/);
        await shot('win');
        const used = await evaluate(
          "[...window.qaDrawnImages,...[...document.images].filter(i=>i.naturalWidth>0).map(i=>i.currentSrc||i.src),...[...document.querySelectorAll('*')].map(e=>getComputedStyle(e).backgroundImage)]",
        );
        result.suppliedImagesUsed = [catPng, forestPng].map((png) =>
          used.some((u) => u.includes(png.toString('base64'))),
        );
        assert.deepEqual(result.suppliedImagesUsed, [true, true]);
        result.actions = [
          'Enter',
          'water damage',
          'repeat touch/1 second immunity',
          ...(scenario === 'pixel' ? ['lose'] : []),
          'R',
          'reset',
          'Right',
          'Right',
          'Down',
          'Right',
          'win',
        ];
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(network, []);
      result.status = 'passed';
      console.log(
        'PASS',
        browser,
        scenario,
        'real generated game rules/feedback/inputs/images; no external requests',
      );
    } catch (error) {
      result.status = 'failed';
      result.error = String(error);
      if (evaluate)
        result.lastText = await evaluate('document.body.innerText').catch(
          () => null,
        );
      if (send) {
        const shot = await send('Page.captureScreenshot', {
          format: 'png',
        }).catch(() => null);
        if (shot)
          await fs.writeFile(
            path.join(output, `${browser.toLowerCase()}-failure.png`),
            Buffer.from(shot.data, 'base64'),
          );
      }
      throw error;
    } finally {
      result.errors = errors;
      result.externalRequests = network;
      evidence.push(result);
      await fs.writeFile(
        path.join(output, 'browser-evidence.json'),
        JSON.stringify(evidence, null, 2),
      );
      if (send) await send('Browser.close').catch(() => {});
      ws?.close();
      if (child.exitCode === null) {
        const exit = new Promise((r) => child.once('exit', r));
        await Promise.race([exit, pause(3000)]);
        if (child.exitCode === null) {
          child.kill();
          await exit;
        }
      }
    }
  }
} finally {
  assert.equal(path.dirname(root), parent);
  assert.equal((await fs.lstat(root)).isSymbolicLink(), false);
  await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
}
