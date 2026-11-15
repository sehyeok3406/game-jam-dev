// Explicit integration check using the public npm package and the built Windows runtime.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { compileStandaloneGame } from '../src/adapters/node/game-preparation/compile.ts';
import { NodeDependencyPreparationEngine } from '../src/adapters/node/game-preparation/engine.ts';

const runtime = path.resolve(
  process.env.GAMEJAM_PREPARATION_RUNTIME ?? 'out/game-build-runtime',
);
const parent = await fs.realpath(os.tmpdir());
const root = await fs.mkdtemp(path.join(parent, 'gamejam-tegaki-'));
const options = {
  runtime,
  cacheRoot: path.join(root, 'cache'),
  assertCurrent() {},
};
const engine = new NodeDependencyPreparationEngine(options);

try {
  const request = {
    version: 1,
    action: 'prepare',
    packages: [
      {
        name: 'tegaki',
        version: '1.1.0',
        reason: 'Korean and English handwriting',
      },
    ],
  };
  const prepared = await engine.execute(request, AbortSignal.timeout(120_000));
  assert.equal(prepared.action, 'prepared');
  assert.deepEqual(Object.keys(prepared.lock.roots), ['tegaki']);
  assert.equal(prepared.lock.packages[0].version, '1.1.0');
  assert.ok(
    prepared.materials[0].documents.some(({ source }) =>
      source.endsWith('README.md'),
    ),
  );
  assert.ok(
    prepared.materials[0].documents.some(({ source }) =>
      source.endsWith('index.d.mts'),
    ),
  );
  assert.match(
    prepared.notices.packages[0].text,
    /Nanum Pen Script[\s\S]*SIL Open Font License/,
  );

  const source = {
    plan: {
      version: 1,
      entry: 'main.js',
      html: 'index.html',
      files: ['main.js', 'index.html'],
      assets: [],
    },
    sources: {
      'index.html':
        '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Tegaki offline check</title></head><body><div id="writing" style="width:400px;font-size:48px"></div><script type="module" src="./main.js"></script></body></html>',
      'main.js': `
import { TegakiEngine } from 'tegaki/core';
import font from 'tegaki/fonts/nanum-pen-script';
const text = '한글 Hello';
const target = document.querySelector('#writing');
const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
async function check() {
  const fonts = await Promise.all([font.fontUrl, font.fullFontUrl].map((url, index) =>
    new FontFace('fixture-font-' + index, 'url(' + url + ')').load()));
  const engine = new TegakiEngine(target, { text, font, time: 0 });
  await frame();
  const canvas = target.querySelector('[data-tegaki="canvas"]');
  const initial = canvas.toDataURL();
  engine.update({ time: 3 });
  await frame();
  const final = canvas.toDataURL();
  const context = canvas.getContext('2d');
  const pixel = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const result = {
    glyphs: ['한', '글', 'H', 'e'].every(char => font.glyphData[char]?.s.length > 0),
    loaded: fonts.every(face => face.status === 'loaded'),
    embedded: [font.fontUrl, font.fullFontUrl].every(url => url.startsWith('data:font/ttf;base64,')),
    strokesDrawn: initial !== final && pixel.some((value, index) => index % 4 === 3 && value > 0),
  };
  engine.destroy();
  return result;
}
window.result = check().catch(error => ({ error: error.message }));`,
    },
  };
  const output = await compileStandaloneGame(
    { ...options, local: true },
    source,
    {},
    prepared,
    engine.workspace(),
    AbortSignal.timeout(120_000),
  );
  await engine.close();
  const filename = path.join(root, 'handwriting.html');
  await fs.writeFile(filename, output.html);
  assert.equal(output.profile, 'standalone-browser-v1');
  assert.ok(output.html.includes("connect-src 'none'"));
  assert.doesNotMatch(output.html, /new URL\(["']\.\/nanum-pen-script/);

  const runner = path.join(root, 'check.cjs');
  const report = path.join(root, 'result.json');
  await fs.writeFile(
    runner,
    `
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const [, , filename, report, profile] = process.argv;
app.setPath('userData', profile);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false, sandbox: true } });
  const address = pathToFileURL(filename).href;
  const blocked = [];
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'file:///*'] }, (request, done) => {
    const cancel = request.url !== address || request.resourceType !== 'mainFrame';
    if (cancel) blocked.push(request.resourceType);
    done({ cancel });
  });
  await win.loadFile(filename);
  const result = await win.webContents.executeJavaScript('window.result');
  fs.writeFileSync(report, JSON.stringify({ result, blocked }));
  app.exit(0);
}).catch(error => {
  fs.writeFileSync(report, JSON.stringify({ error: error.message }));
  app.exit(1);
});`,
  );
  const electron = createRequire(import.meta.url)('electron');
  const profile = path.join(root, 'electron');
  await fs.mkdir(profile);
  await promisify(execFile)(electron, [runner, filename, report, profile], {
    windowsHide: true,
    timeout: 30_000,
  });
  const evidence = JSON.parse(await fs.readFile(report, 'utf8'));
  assert.deepEqual(evidence, {
    result: { glyphs: true, loaded: true, embedded: true, strokesDrawn: true },
    blocked: [],
  });
  if (process.env.GAMEJAM_TEGAKI_HTML)
    await fs.copyFile(filename, path.resolve(process.env.GAMEJAM_TEGAKI_HTML));
  console.log(
    `tegaki@1.1.0: Korean and English strokes, both embedded fonts, no network or media sidecars; ${Buffer.byteLength(output.html)} HTML bytes`,
  );
} finally {
  await engine.close();
  assert.equal(path.dirname(root), parent);
  await fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
