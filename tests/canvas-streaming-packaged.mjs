import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import matter from 'gray-matter';
import { mixedCanvasFixture } from './helpers/mixed-canvas-fixture.ts';
import { fixturePng } from './helpers/fixture-png.mjs';
import { serializeGameUi, gameUiPath } from '../src/game-ui-model.ts';
import {
  game,
  profile,
  boot,
  stop,
  wait,
  js,
  send,
  mouse,
  key,
  pause,
  packageProcessId,
  packageFrameSessions,
} from './helpers/packaged-canvas.mjs';

const out = 'out/canvas-stage7/packaged';
await fs.mkdir(out, { recursive: true });
const fixture = mixedCanvasFixture(1000, {
  sources: [],
  status: 'raw',
  modifiedAt: 1,
});
const write = async (relative, content) => {
  const target = path.join(game, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
};
await write(
  'project.md',
  matter.stringify('# 최종 캔버스 검증\n', {
    id: 'stage7-project',
    title: '최종 캔버스 검증',
    type: 'system',
    x: 0,
    y: -600,
    width: 420,
    height: 330,
  }),
);
for (const doc of fixture.documents) {
  const { body, ...metadata } = doc;
  if (metadata.asset) {
    const png = fixturePng(Number(doc.id.split('-')[1]));
    metadata.asset = {
      ...metadata.asset,
      mime: 'image/png',
      bytes: png.length,
    };
    await write(metadata.asset.path, png);
  }
  await write(
    doc.relativePath,
    matter.stringify(body, JSON.parse(JSON.stringify(metadata))),
  );
}
await write(
  '.canvas/drawings/default.json',
  JSON.stringify({
    version: 3,
    canvasId: 'default',
    objects: fixture.drawings.map(
      ({ canvasId: _canvasId, ...object }) => object,
    ),
  }),
);
for (const frame of fixture.frames)
  await write(gameUiPath(frame.id), serializeGameUi(frame));
for (const preview of fixture.previews)
  await write(preview.relativePath, preview.content);
await fs.writeFile(
  path.join(profile, 'test-user.json'),
  JSON.stringify({ nickname: '최종 캔버스 검증' }),
);
const call = (name, ...args) =>
  js(`gameCanvas[${JSON.stringify(name)}](...${JSON.stringify(args)})`);
const rows = [];
const flags = [
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];
const watchdog = setTimeout(() => {
  console.error('Packaged streaming timeout');
  void stop().finally(() => process.exit(1));
}, 360000);
const processMemory = async () => {
  const rootPid = packageProcessId();
  assert.ok(Number.isInteger(rootPid));
  const command = `$canvasRootProcessId=${rootPid}; $canvasChildren=Get-CimInstance Win32_Process -Filter "ParentProcessId=$canvasRootProcessId"; $canvasRoles=@{}; $canvasRoles[$canvasRootProcessId]='Browser'; foreach($canvasChild in $canvasChildren){ $canvasRoles[[int]$canvasChild.ProcessId]=if($canvasChild.CommandLine -match '--type=([^ ]+)'){$Matches[1]}else{'Helper'} }; @(Get-Process -Id @($canvasRoles.Keys) -ErrorAction SilentlyContinue | ForEach-Object { @{id=$_.Id; type=$canvasRoles[$_.Id]; workingSetBytes=$_.WorkingSet64; privateBytes=$_.PrivateMemorySize64} }) | ConvertTo-Json -Compress`;
  const { stdout } = await promisify(execFile)(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    { windowsHide: true },
  );
  return JSON.parse(stdout);
};
const snap = async () => ({
  documents: await call('listDocuments'),
  drawings: await call('listDrawings'),
  frames: await call('listGameUi'),
  history: (await call('listHistory')).length,
});
const camera = () =>
  js('document.querySelector(".react-flow__viewport").style.transform');
const waitFor = async (code) => {
  for (let n = 0; n < 600; n++) {
    if (await js(code)) return;
    await pause();
  }
  throw Error('Timeout: ' + code);
};
const zoom100 = async () => {
  await js(
    "document.querySelector('.canvas-zoom-menu summary').click();[...document.querySelectorAll('.canvas-zoom-menu button')].find(b=>b.textContent.trim()==='100%로 보기').click()",
  );
  await waitFor(
    'document.querySelector(".canvas-zoom-menu summary").textContent.includes("100%")',
  );
};
try {
  console.log('PACKAGED booting');
  await boot(true, process.env, { extraArgs: flags, showWindow: true });
  console.log('PACKAGED workspace opened');
  await waitFor(
    'document.querySelectorAll(".react-flow__node-drawing").length===400 && document.querySelectorAll(".react-flow__node-game-ui").length===50',
  );
  let presented;
  for (let i = 0; i < 200; i++) {
    presented = await fs
      .readFile(path.join(profile, 'launch-status.json'), 'utf8')
      .then(JSON.parse)
      .catch(() => null);
    if (presented) break;
    await pause();
  }
  assert.equal(
    presented?.windowVisible,
    true,
    'packaged native window is visible',
  );
  const actual = {
    documents: (await call('listDocuments')).filter((d) =>
      d.id.startsWith('mixed-'),
    ).length,
    drawings: (await call('listDrawings')).length,
    gameUi: (await call('listGameUi')).length,
    html: (await call('listPreviews')).length,
  };
  assert.deepEqual(actual, {
    documents: 500,
    drawings: 400,
    gameUi: 50,
    html: 50,
  });
  console.log('PACKAGED mixed models loaded', actual);
  for (const [relative, state] of Object.entries(fixture.windows))
    await call('savePreviewWindow', state, relative);
  // Re-enter through the real UI so the saved personal window layouts load.
  await js(
    'document.querySelector(\'[title="프로젝트 홈으로 돌아가기"]\').click()',
  );
  await wait('!!document.querySelector(".home-project-open")');
  await js('document.querySelector(".home-project-open").click()');
  await waitFor(
    'document.querySelectorAll(".react-flow__node-drawing").length===400',
  );
  const before = await snap();
  await send('Page.bringToFront');
  console.log('PACKAGED layouts loaded');
  const nativeMemoryBefore = await processMemory();
  for (const width of [1920, 3440, 5120]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitFor(
      `document.querySelector('.react-flow').clientWidth===${width}`,
    );
    assert.ok(await js('document.documentElement.scrollWidth<=innerWidth'));
    rows.push({
      check: 'packaged wide viewport',
      width,
      nodes: await js('document.querySelectorAll(".react-flow__node").length'),
    });
  }
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1500,
    height: 1050,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await zoom100();
  console.log('PACKAGED wide layouts checked');
  await send('Page.enable');
  const tree = await send('Page.getFrameTree');
  const frame = tree.frameTree.childFrames?.[0]?.frame;
  let world, childSession;
  if (frame)
    world = await send('Page.createIsolatedWorld', {
      frameId: frame.id,
      worldName: 'canvas-state-qa',
    });
  else {
    await send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
    for (let i = 0; i < 100 && !packageFrameSessions().length; i++)
      await pause();
    childSession = packageFrameSessions()[0];
    assert.ok(childSession, 'real HTML frame session');
  }
  const frameJs = async (expression) => {
    const result = await send(
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true,
        ...(world ? { contextId: world.executionContextId } : {}),
      },
      childSession,
    );
    assert.ok(
      !result.exceptionDetails,
      JSON.stringify(result.exceptionDetails),
    );
    return result.result.value;
  };
  const token = crypto.randomUUID();
  assert.equal(
    await frameJs(
      `document.body.dataset.canvasState=${JSON.stringify(token)};document.querySelector('input').value='진행 중 입력';document.body.dataset.canvasState`,
    ),
    token,
  );
  await js('document.querySelector(\'[title="이동 도구 (H)"]\').click()');
  await waitFor(
    "document.querySelector('.app-shell').classList.contains('app-shell--tool-hand')",
  );
  await js("document.querySelector('.document-card__content').click()");
  await pause();
  assert.equal(
    await js(
      "document.querySelectorAll('.document-card [contenteditable=true]').length",
    ),
    0,
    'hand tool cannot open an editor while navigating',
  );
  const point = await js(
    `(()=>{for(let y=180;y<780;y+=25)for(let x=250;x<1150;x+=25)if(document.elementFromPoint(x,y)?.classList.contains('react-flow__pane'))return {x,y};throw Error('No canvas gap')})()`,
  );
  const firstCamera = await camera();
  await js(
    `window.__cameraFrames=[];window.__sampling=true;let previous=0;requestAnimationFrame(function tick(t){if(!__sampling)return;if(previous)__cameraFrames.push(t-previous);previous=t;requestAnimationFrame(tick);});window.__frames=[...document.querySelectorAll('.preview-card iframe')];window.__frameWindows=__frames.map(f=>f.contentWindow);true;`,
  );
  assert.equal(
    await js('__frames.length'),
    50,
    'all HTML games remain mounted',
  );
  for (let round = 0; round < 4; round++) {
    await mouse('mousePressed', point.x, point.y);
    for (let i = 1; i <= 8; i++)
      await mouse(
        'mouseMoved',
        point.x + (round % 2 ? -1 : 1) * i * 20,
        point.y + i * 3,
      );
    await mouse(
      'mouseReleased',
      point.x + (round % 2 ? -1 : 1) * 160,
      point.y + 24,
    );
    for (let i = 0; i < 5; i++)
      await send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: point.x,
        y: point.y,
        deltaY: round % 2 ? -90 : 90,
        deltaX: 0,
      });
  }
  await pause();
  assert.notEqual(await camera(), firstCamera);
  assert.ok(
    await js(
      '__frames.every((f,i)=>f===document.querySelectorAll(".preview-card iframe")[i]&&f.contentWindow===__frameWindows[i])',
    ),
  );
  assert.deepEqual(
    await frameJs(
      `({token:document.body.dataset.canvasState,input:document.querySelector('input').value})`,
    ),
    { token, input: '진행 중 입력' },
  );
  const after = await snap();
  assert.deepEqual(
    after,
    before,
    'camera changes neither project contents/geometry nor history',
  );
  const timings = await js(
    'window.__sampling=false;__cameraFrames.sort((a,b)=>a-b);({p95:__cameraFrames[Math.floor(__cameraFrames.length*.95)],max:Math.max(...__cameraFrames),samples:__cameraFrames.length})',
  );
  rows.push({
    check:
      'real packaged 1000-node native pan/wheel preserves content/history/iframes',
    ...actual,
    preservedFrames: 50,
    ...timings,
    nativeMemoryBefore,
    nativeMemoryAfter: await processMemory(),
  });
  console.log('PACKAGED native camera checked');
  await js('document.querySelector(\'[title="선택 도구 (V)"]\').click()');
  await key('f', 'KeyF', 70, 2);
  await waitFor('!!document.querySelector(".canvas-find input")');
  await send('Input.insertText', { text: '혼합 0' });
  await waitFor(
    'document.querySelector(\'.react-flow__node[data-id="mixed-0"]\')?.classList.contains("selected")',
  );
  await key('Escape', 'Escape', 27);
  await zoom100();
  await js(
    'document.querySelector(\'[data-find-document="mixed-0"] .document-card__content\').click()',
  );
  await waitFor(
    '!!document.querySelector(\'[data-find-document="mixed-0"] .tiptap[contenteditable="true"]\')',
  );
  const editor =
    '[data-find-document="mixed-0"] .tiptap[contenteditable="true"]';
  await js(
    `{const e=document.querySelector('${editor}');e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);}`,
  );
  await send('Input.insertText', { text: ' 패키지 최종 저장 검증' });
  await key('Escape', 'Escape', 27);
  await waitFor(
    'gameCanvas.getDocument("docs/mixed-0.md").then(d=>d?.body.includes("패키지 최종 저장 검증"))',
  );
  const saved = await call('getDocument', 'docs/mixed-0.md');
  console.log('PACKAGED document saved');
  await fs.writeFile(
    path.join(out, 'mixed-1000.png'),
    Buffer.from(
      (await send('Page.captureScreenshot', { format: 'png' })).data,
      'base64',
    ),
  );
  const expected = {
    documents: (await call('listDocuments')).filter((d) =>
      d.id.startsWith('mixed-'),
    ),
    drawings: await call('listDrawings'),
    frames: await call('listGameUi'),
  };
  await stop(true);
  console.log('PACKAGED stopped normally');
  await boot(true, process.env, { extraArgs: flags, showWindow: true });
  console.log('PACKAGED restarted');
  await waitFor(
    'document.querySelectorAll(".react-flow__node-drawing").length===400',
  );
  assert.deepEqual(
    {
      documents: (await call('listDocuments')).filter((d) =>
        d.id.startsWith('mixed-'),
      ),
      drawings: await call('listDrawings'),
      frames: await call('listGameUi'),
    },
    expected,
  );
  assert.equal((await call('getDocument', 'docs/mixed-0.md')).body, saved.body);
  rows.push({
    check: 'actual save and full executable restart preserve all mixed models',
    complete: true,
  });
  await fs.writeFile(
    path.join(out, 'result.json'),
    JSON.stringify(
      {
        complete: true,
        fixture: fixture.counts,
        rows,
        artifactHashes: Object.fromEntries(
          await Promise.all(
            [
              'out/Game Jam!-win32-x64/Game Canvas.exe',
              'out/Game Jam!-win32-x64/resources/app.asar',
            ].map(async (file) => [
              file,
              crypto
                .createHash('sha256')
                .update(await fs.readFile(file))
                .digest('hex'),
            ]),
          ),
        ),
      },
      null,
      2,
    ),
  );
  console.log('PASS packaged canvas streaming', JSON.stringify(rows));
} catch (error) {
  try {
    await fs.writeFile(
      path.join(out, 'failure.png'),
      Buffer.from(
        (await send('Page.captureScreenshot', { format: 'png' })).data,
        'base64',
      ),
    );
  } catch {}
  throw error;
} finally {
  clearTimeout(watchdog);
  await stop();
}
