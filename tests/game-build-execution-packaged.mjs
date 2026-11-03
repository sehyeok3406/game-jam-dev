// Production IPC/executor/validator/storage with a local CLI fixture. No paid AI calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import {
  root,
  profile,
  game,
  boot,
  stop,
  js,
  send,
  pause,
  appProcessId,
} from './helpers/packaged-canvas.mjs';
import { gamejamTaskInput } from '../src/gamejam-request.ts';
import { captureProject } from '../src/project-store.ts';
import {
  readGameBuildIndex,
  readGameBuild,
} from '../src/core/projects/game-build.ts';
import { gameBuildCodec as codec } from '../src/adapters/node/game-build-codec.ts';
import matter from '../src/markdown.ts';
import { readClientCache } from '../src/client-cache.ts';
const call = async (method, ...args) => {
  // A terminal history receipt can precede the coordinator's final resource release.
  for (let attempt = 0; ; attempt++) {
    try {
      return await js(
        `window.gameCanvas[${JSON.stringify(method)}](...${JSON.stringify(args)})`,
      );
    } catch (error) {
      if (
        method !== 'createTask' ||
        attempt >= 50 ||
        !String(error).includes('이미 AI 작업이 진행 중입니다')
      )
        throw error;
      await pause();
    }
  }
};
const editing = process.env.GAMEJAM_BUILD_EDITING === '1';
const transfer = process.env.GAMEJAM_BUILD_TRANSFER === '1';
const evidenceDirectory = transfer
  ? 'out/game-build-stage6'
  : editing
    ? 'out/game-build-stage5'
    : 'out/game-build-stage4';
await fs.mkdir(evidenceDirectory, { recursive: true });
const bin = path.join(root, 'mock-bin'),
  cli = path.join(bin, 'node_modules/@anthropic-ai/claude-code/cli.js');
const image =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
await fs.mkdir(path.dirname(cli), { recursive: true });
await fs.writeFile(path.join(bin, 'claude.cmd'), '@echo off\r\nexit /b 1\r\n');
await fs.writeFile(
  cli,
  `
const fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2);
const matter=require(${JSON.stringify(path.resolve('node_modules/gray-matter'))});
if(args.includes('--version')){console.log('2.1.50 (Claude Code)');process.exit(0);}
if(args.includes('--help')){console.log('--restricted --strict-mcp-config --tools --output-format');process.exit(0);}
if(args[0]==='auth')process.exit(0);
if(!args.includes('--print'))process.exit(2);
let prompt='';process.stdin.on('data',d=>prompt+=d);process.stdin.on('end',()=>{
 const three=args.some(a=>['build-three','edit-three','new-three'].includes(a));
 if(fs.existsSync('.ai/tasks/dependency-response.json')){
  const r=JSON.parse(fs.readFileSync('.ai/tasks/dependency-response.json','utf8'));
  const previous=r.previousLock;
  const packages=previous?.packages.length?Object.entries(previous.roots).map(([name,key])=>({name,version:previous.packages.find(p=>p.key===key).version,reason:'Preserve the game fixed dependency'})):three?[{name:'three',version:'0.187.0',reason:'Vector math for player movement'}]:[];
  const request=packages.length&&r.sequence===1?{version:1,action:'prepare',packages}:{version:1,action:'done',lockSha256:r.response?.lockSha256??null};
  fs.writeFileSync('.ai/tasks/dependency-request-'+r.sequence+'.json',JSON.stringify({version:1,runId:r.runId,sequence:r.sequence,request}));
 }else if(fs.existsSync('.ai/tasks/game-build-context.json')){
  const ctx=JSON.parse(fs.readFileSync('.ai/tasks/game-build-context.json','utf8'));if(three&&ctx.dependencies.selection[0].version!=='0.187.0')throw Error('wrong dependency version');
  if(ctx.previousSource){
    if(!fs.existsSync('source/main.js'))throw Error('missing editable source');
    fs.writeFileSync('source/main.js',args.includes('fail-local')?"import 'unprepared-engine';":fs.readFileSync('source/main.js','utf8').replace(/dataset.lives='[0-9]+'/g,"dataset.lives='9'").replace(/목숨 7개/g,'목숨 9개')+";document.body.dataset.edit='yes';document.querySelector('p').textContent='← → 이동 · 목숨 9개 · 전투 금지';");
  }else{
  fs.mkdirSync('source');
  fs.writeFileSync('source/main.js',(three?"import {Vector2} from 'three';const movement=new Vector2(3,4);if(movement.length()!==5)throw Error('Three API failed');":'')+"import assets from 'gamejam:assets';import './style.css';document.body.dataset.lives='7';const c=document.querySelector('canvas'),g=c.getContext('2d');let x=90;function draw(){g.fillStyle='#142236';g.fillRect(0,0,480,280);g.fillStyle='#88e0ad';g.fillRect(x,140,35,35);g.fillStyle='white';g.font='22px sans-serif';g.fillText('목숨 7개 · 전투 없는 숲',28,40);}draw();document.addEventListener('keydown',e=>{if(e.key==='ArrowRight')x+=10;if(e.key==='ArrowLeft')x-=10;draw();});document.querySelector('#hero').src=assets.hero;");
  fs.writeFileSync('source/style.css','body{margin:0;background:#0e1828;color:white;font-family:sans-serif;display:grid;place-content:center;height:100vh}canvas{border:2px solid #88e0ad}img{width:24px;height:24px}');
  fs.writeFileSync('source/index.html','<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>숲의 이동</title><script type="module" src="./main.js"></script></head><body><h1>숲의 이동</h1><canvas width="480" height="280"></canvas><img id="hero" src="gamejam:asset/hero"><p>← → 이동 · 목숨 7개 · 전투 금지</p></body></html>');
  fs.writeFileSync('source-plan.json',JSON.stringify({version:1,entry:'main.js',html:'index.html',files:['main.js','style.css','index.html'],assets:[{key:'hero',path:'assets/images/hero.gif'}]}));
  if(args.includes('reimport-html')){
    const taskFile=fs.readdirSync('.ai/tasks').find(p=>p.endsWith('.md'));
    const task=matter(fs.readFileSync('.ai/tasks/'+taskFile,'utf8')).data;
    const html=fs.readFileSync(task.inputs.find(p=>p.endsWith('.html')),'utf8');
    const embedded=html.match(new RegExp('data:image/gif;base64,[A-Za-z0-9+/=]+'))?.[0];if(!embedded)throw Error('exported image missing');
    fs.writeFileSync('source/main.js',fs.readFileSync('source/main.js','utf8').replace(/dataset.lives='7'/g,"dataset.lives='9'").replace(/목숨 7개/g,'목숨 9개').replace("document.querySelector('#hero').src=assets.hero;",''));
    fs.writeFileSync('source/index.html',fs.readFileSync('source/index.html','utf8').replace('gamejam:asset/hero',embedded).replace(/목숨 7개/g,'목숨 9개'));
    const plan=JSON.parse(fs.readFileSync('source-plan.json','utf8'));plan.assets=[];fs.writeFileSync('source-plan.json',JSON.stringify(plan));
  }
  }
 }else {
  const relative=prompt.match(/at (\\.ai\\/tasks\\/[^\\n]+\\.md)\\./)?.[1];if(!relative)throw Error('unexpected execution phase');
  const task=matter(fs.readFileSync(relative,'utf8')).data,format=task.document_output_format;
  for(const doc of format.documents){const old=fs.existsSync(doc.path)?matter(fs.readFileSync(doc.path,'utf8')).data:{};fs.mkdirSync(path.dirname(doc.path),{recursive:true});fs.writeFileSync(doc.path,matter.stringify(args.includes('edit-docs')?'목숨 9개, 전투 금지. 기존 숲과 이미지 유지.':'목숨 7개, 전투 금지. 숲의 화면과 이미지 사용.',{...old,id:old.id??'design-'+task.id,title:doc.title,type:doc.type,status:'draft',sources:['project'],document_bundle_id:format.id,document_output:{key:doc.key,instructions:doc.instructions}}));}
 }
 console.log(JSON.stringify({type:'result',is_error:false,result:'source fixture complete'}));
});
`,
);
await fs.writeFile(
  path.join(game, 'project.md'),
  '---\nid: project\ntitle: 숲의 이동\ntype: idea\nstatus: draft\nsources: []\n---\n목숨은 7개. 전투 금지. 화살표로 이동.\n',
);
await fs.mkdir(path.join(game, 'assets/images'), { recursive: true });
await fs.writeFile(
  path.join(game, 'assets/images/hero.gif'),
  Buffer.from(image.split(',')[1], 'base64'),
);
await fs.mkdir(path.join(game, 'ideas'), { recursive: true });
await fs.writeFile(
  path.join(game, 'ideas/hero.md'),
  matter.stringify('게임에 사용할 선택 이미지', {
    id: 'hero-card',
    title: 'Hero',
    type: 'image',
    status: 'draft',
    sources: [],
    asset: {
      path: 'assets/images/hero.gif',
      purpose: 'asset',
      originalName: 'hero.gif',
      mime: 'image/gif',
      bytes: Buffer.from(image.split(',')[1], 'base64').length,
    },
    x: 600,
    y: 100,
    width: 300,
    height: 260,
  }),
);
const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH };
async function execute(modelId, options = {}) {
  const activeRoot = (await call('getWorkspace')).root;
  const beforeFiles = options.expectFailure
    ? activeRoot === game
      ? await captureProject(activeRoot)
      : (await readClientCache(path.join(activeRoot, 'server-cache.json')))
          .files
    : undefined;
  assert.ok(
    activeRoot === game || activeRoot?.startsWith(profile + path.sep),
    'test must stay in its local project or isolated profile mirror',
  );
  const inputs = (await call('listDocuments'))
    .filter((doc) => ['project', 'hero-card'].includes(doc.id))
    .map((doc) => doc.relativePath);
  assert.equal(inputs.length, 2);
  const task = await call(
    'createTask',
    gamejamTaskInput({
      organize: options.organize ?? modelId === 'build-local',
      implement: true,
      inputPaths: inputs,
      instructions: {
        organize: '목숨 7개, 전투 금지를 보존한 제작 기준 문서.',
        implement: options.previous
          ? '목숨 9개로 수정. 기존 전투 금지, 이동, 숲 이미지 유지.'
          : '목숨 7개, 전투 금지. 화살표로 이동하는 숲 게임.',
      },
      documentResult: {
        mode: options.documentBase ? 'update' : 'new',
        ...(options.documentBase ? { baseDir: options.documentBase } : {}),
        structure: 'custom',
        documents: [
          {
            key: 'd1',
            title: '제작 기준',
            type: 'overview',
            instructions: '원본 요구 보존',
          },
        ],
      },
      htmlResult: {
        mode: options.mode ?? (options.previous ? 'update' : 'new'),
        ...(options.previous
          ? { basePath: options.previous.artifact.path }
          : {}),
      },
      resultName:
        options.mode === 'new' && options.previous
          ? options.previous.artifact.path.split('/')[2]
          : '숲의 이동 ' + modelId,
      x: 100,
      y: 100,
    }),
  );
  const started = await call('startCodexRun', {
    taskPath: task.relativePath,
    providerId: 'claude-cli',
    modelId,
  });
  console.log('START:', modelId, started.runId);
  let event;
  for (let n = 0; n < 600; n++) {
    event = (await call('listHistory')).find(
      (h) =>
        h.kind === 'ai' &&
        (h.id === started.runId || h.taskPath === task.relativePath) &&
        (h.status === 'failed' ||
          h.status === 'cancelled' ||
          (h.status === 'completed' &&
            h.files.some((f) => f.relativePath.endsWith('.html')))),
    );
    if (event) break;
    await pause();
  }
  if (options.expectFailure) {
    assert.equal(event?.status, 'failed', JSON.stringify(event));
    const files =
      activeRoot === game
        ? await captureProject(activeRoot)
        : (await readClientCache(path.join(activeRoot, 'server-cache.json')))
            .files;
    assert.equal(
      files[options.previous.artifact.path],
      options.previous.files[options.previous.artifact.path],
    );
    assert.deepEqual(
      readGameBuildIndex(files),
      readGameBuildIndex(beforeFiles),
    );
    console.log(
      'PASS: failed source build preserves the previous source and HTML',
    );
    return { files, event };
  }
  assert.equal(event?.status, 'completed', JSON.stringify(event));
  const outputPath = event.files.find(
    (f) =>
      f.relativePath.startsWith('output/') && f.relativePath.endsWith('.html'),
  ).relativePath;
  let files, artifact, saved;
  for (let n = 0; n < 200; n++) {
    files =
      activeRoot === game
        ? await captureProject(activeRoot)
        : (await readClientCache(path.join(activeRoot, 'server-cache.json')))
            .files;
    artifact = readGameBuildIndex(files).artifacts.find(
      (a) => a.path === outputPath,
    );
    if (
      artifact &&
      (!options.previous ||
        artifact.buildId !== options.previous.artifact.buildId)
    ) {
      try {
        saved = readGameBuild(files, artifact.buildId, codec);
        break;
      } catch {}
    }
    await pause();
  }
  assert.ok(
    saved,
    'committed result must reach the existing durable repository/cache',
  );
  assert.equal(
    saved.sources['main.js'].includes(
      options.previous ? "dataset.lives='9'" : "dataset.lives='7'",
    ),
    true,
  );
  if (options.previous) {
    assert.equal(
      saved.sources['style.css'],
      options.previous.saved.sources['style.css'],
    );
    assert.deepEqual(
      saved.manifest.assets,
      options.previous.saved.manifest.assets,
    );
    assert.deepEqual(saved.lock, options.previous.saved.lock);
    assert.notEqual(artifact.buildId, options.previous.artifact.buildId);
    assert.equal(
      artifact.artifactId === options.previous.artifact.artifactId,
      options.mode !== 'new',
    );
    if (options.mode === 'new')
      assert.equal(
        files[options.previous.artifact.path],
        options.previous.files[options.previous.artifact.path],
      );
  }
  assert.equal(
    Object.values(files).some((raw) => raw.includes('목숨은 7개. 전투 금지.')),
    true,
  );
  assert.equal(saved.manifest.assets[0].sha256, codec.digest(image));
  if (modelId.includes('three'))
    assert.equal(
      saved.lock.packages.find((p) => p.name === 'three').version,
      '0.187.0',
    );
  else assert.equal(saved.lock.packages.length, 0);
  assert.equal(files[artifact.path].split(image).length - 1, 1);
  await fs.writeFile(
    `${evidenceDirectory}/${modelId}.html`,
    files[artifact.path],
  );
  console.log(
    'PASS:',
    modelId,
    'production IPC → CLI file exchange → source → actual bundle → Electron validation → atomic source/HTML history',
    saved.manifest.output.bytes,
    'bytes',
  );
  return { artifact, saved, files, event };
}
async function nativeExport(
  relativePath,
  destination,
  cancel = false,
  click = false,
) {
  if (click)
    for (let n = 0; n < 160; n++) {
      if (
        await js(
          `!![...document.querySelectorAll('.preview-card .canvas-file-header__title[title]')].find(e=>e.title.endsWith(${JSON.stringify(relativePath)}))?.closest('.preview-card').querySelector('[aria-label="게임 HTML 내보내기"]')`,
        )
      )
        break;
      await pause();
    }
  const pending = click
    ? js(
        `(()=>{const title=[...document.querySelectorAll('.preview-card .canvas-file-header__title[title]')].find(e=>e.title.endsWith(${JSON.stringify(relativePath)}));if(!title)throw Error('preview missing');const button=title.closest('.preview-card').querySelector('[aria-label="게임 HTML 내보내기"]');if(!button)throw Error('export action missing');button.click();return true;})()`,
      )
    : call('exportPreviewHtml', relativePath);
  const process = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.resolve('tests/helpers/save-html-dialog.ps1'),
      '-TargetProcessId',
      String(appProcessId()),
      ...(cancel ? ['-Cancel'] : ['-Destination', destination]),
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let diagnostic = '';
  for (const stream of [process.stdout, process.stderr])
    stream.on('data', (d) => {
      diagnostic = (diagnostic + d).slice(-4000);
    });
  const closed = new Promise((resolve, reject) => {
    process.once('error', reject);
    process.once('close', (code) =>
      code === 0 ? resolve() : reject(Error(diagnostic)),
    );
  });
  const [result] = await Promise.all([pending, closed]);
  return result;
}
const transfers = [];
async function roundTrip(previous, label) {
  const destination = path.join(root, `export-${label}.html`);
  assert.equal(
    await nativeExport(previous.artifact.path, destination, true),
    false,
  );
  await assert.rejects(fs.access(destination));
  await nativeExport(previous.artifact.path, destination, false, true);
  let bytes;
  for (let n = 0; n < 200; n++) {
    try {
      bytes = await fs.readFile(destination);
      break;
    } catch {
      await pause();
    }
  }
  assert.deepEqual(bytes, Buffer.from(previous.files[previous.artifact.path]));
  await fs.copyFile(destination, `${evidenceDirectory}/export-${label}.html`);
  const original = (await call('listPreviews')).find(
    (p) => p.relativePath === previous.artifact.path,
  );
  assert.equal(original.build.kind, 'source');
  assert.ok(original.build.documents.some((d) => d.state === 'unchanged'));
  const visibleFacts = await js(
    `(()=>{const title=[...document.querySelectorAll('.preview-card .canvas-file-header__title[title]')].find(e=>e.title.endsWith(${JSON.stringify(previous.artifact.path)}));const panel=title.closest('.preview-card').querySelector('.game-build-summary');if(!panel.open)panel.querySelector('summary').click();return panel.textContent;})()`,
  );
  assert.match(visibleFacts, /수정용 원본 보관됨/);
  assert.match(visibleFacts, /제작 당시 내용과 같음/);
  if (original.build.libraries.length)
    assert.ok(visibleFacts.includes(original.build.libraries[0].version));
  await js(
    `(()=>{const title=[...document.querySelectorAll('.preview-card .canvas-file-header__title[title]')].find(e=>e.title.endsWith(${JSON.stringify(previous.artifact.path)}));title.closest('.react-flow__node').click();document.querySelector('.canvas-zoom-menu summary').click();[...document.querySelectorAll('.canvas-zoom-menu button')].find(e=>e.textContent==='선택 항목 맞춤').click();})()`,
  );
  await new Promise((resolve) => setTimeout(resolve, 400));
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(
    `${evidenceDirectory}/transfer-${label}.png`,
    Buffer.from(screenshot.data, 'base64'),
  );
  const imported = await js(
    `(async()=>{const w=await window.gameCanvas.getWorkspace();return window.gameCanvas.importFiles({scope:w.saveScope,contextId:w.clipboardContextId,x:0,y:0,imagePurpose:'asset',files:[{name:${JSON.stringify(`roundtrip-${label}.html`)},bytes:Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}),c=>c.charCodeAt(0))}]});})()`,
  );
  const importedPath = imported.find((d) => d.htmlSource)?.htmlSource;
  assert.ok(importedPath, 'HTML import returns its existing reference card');
  const importedPreview = (await call('listPreviews')).find(
    (p) => p.relativePath === importedPath,
  );
  assert.equal(importedPreview.build.kind, 'html');
  assert.equal(importedPreview.content, bytes.toString('utf8'));
  const task = await call(
    'createTask',
    gamejamTaskInput({
      organize: false,
      implement: true,
      sourceMode: 'html-compose',
      inputPaths: [importedPath],
      htmlResult: { mode: 'new' },
      instructions: {
        organize: '参考',
        implement: '목숨 9개. 전투 금지. 가져온 이미지를 유지한 새 수정 버전.',
      },
      resultName: '재가져오기-' + label,
      x: 0,
      y: 0,
    }),
  );
  const started = await call('startCodexRun', {
    taskPath: task.relativePath,
    providerId: 'claude-cli',
    modelId: 'reimport-html',
  });
  let history;
  for (let n = 0; n < 600; n++) {
    history = (await call('listHistory')).find(
      (h) =>
        h.kind === 'ai' &&
        (h.id === started.runId || h.taskPath === task.relativePath) &&
        ['failed', 'completed'].includes(h.status) &&
        (h.status === 'failed' ||
          h.files.some(
            (f) =>
              f.relativePath.startsWith('output/') &&
              f.relativePath.endsWith('.html'),
          )),
    );
    if (history) break;
    await pause();
  }
  assert.equal(history?.status, 'completed', JSON.stringify(history));
  const output = history.files.find(
    (f) =>
      f.relativePath.startsWith('output/') && f.relativePath.endsWith('.html'),
  ).relativePath;
  let preview;
  for (let n = 0; n < 200; n++) {
    preview = (await call('listPreviews')).find(
      (p) => p.relativePath === output && p.build?.kind === 'source',
    );
    if (preview) break;
    await pause();
  }
  assert.ok(preview);
  assert.notEqual(output, previous.artifact.path);
  assert.equal(
    (await call('readPreview', importedPath)).content,
    bytes.toString('utf8'),
  );
  assert.deepEqual(
    preview.build.libraries,
    [],
    'Embedded dependency metadata is reference data, not an automatic install/lock import',
  );
  await fs.writeFile(
    `${evidenceDirectory}/reimport-${label}.html`,
    preview.content,
  );
  transfers.push({
    label,
    exportedBytes: bytes.length,
    importedPath,
    output,
    build: preview.build,
  });
  console.log(
    'PASS: native export UI/cancel → exact HTML → inert new import → new source build',
    label,
  );
}
try {
  await boot(true, env);
  const local = await execute('build-local');
  const edits = {};
  if (editing) {
    const rules = local.saved.manifest.documents.find((d) =>
      d.path.startsWith('docs/'),
    );
    const data = matter(local.files[rules.path]).data;
    edits.local = await execute('edit-docs', {
      previous: local,
      organize: true,
      documentBase: 'bundle:' + data.document_bundle_id,
    });
    assert.match(edits.local.files[rules.path], /목숨 9개/);
    edits.newVersion = await execute('new-local', {
      previous: edits.local,
      mode: 'new',
    });
    await execute('fail-local', { previous: edits.local, expectFailure: true });
    await call('restoreHistory', edits.local.event.id, undefined, 'before');
    const restored = await captureProject(game);
    assert.equal(
      restored[local.artifact.path],
      local.files[local.artifact.path],
    );
    assert.equal(restored[rules.path], local.files[rules.path]);
    assert.deepEqual(
      readGameBuildIndex(restored).artifacts.find(
        (a) => a.path === edits.newVersion.artifact.path,
      ),
      edits.newVersion.artifact,
    );
    await call('restoreHistory', edits.local.event.id, undefined, 'after');
    assert.equal(
      (await captureProject(game))[local.artifact.path],
      edits.local.files[local.artifact.path],
    );
    console.log(
      'PASS: source-based edit, coupled design update, new version, failure and before/after restoration',
    );
  }
  if (transfer) await roundTrip(edits.local ?? local, 'local');
  await stop(true);
  await boot(true, env);
  const reopened = await captureProject(game);
  assert.equal(
    readGameBuild(reopened, local.artifact.buildId, codec).sources['main.js'],
    local.saved.sources['main.js'],
  );
  const internal = await call('startLocalCollaborationServer');
  await call('createCollaboration', {
    serverUrl: internal.serverUrl,
    serverKey: '',
    nickname: '빌드 검사 관리자',
  });
  const shared = await execute(
    process.env.GAMEJAM_PUBLIC_BUILD === '1' ? 'build-three' : 'build-local',
  );
  if (editing) {
    edits.shared = await execute(
      process.env.GAMEJAM_PUBLIC_BUILD === '1' ? 'edit-three' : 'edit-local',
      { previous: shared },
    );
    await call('restoreHistory', edits.shared.event.id, undefined, 'before');
    const workspace = await call('getWorkspace');
    const awaitSharedBuild = async (buildId) => {
      let files;
      for (let n = 0; n < 200; n++) {
        files = (
          await readClientCache(path.join(workspace.root, 'server-cache.json'))
        ).files;
        if (
          readGameBuildIndex(files).artifacts.some(
            (a) => a.path === shared.artifact.path && a.buildId === buildId,
          )
        )
          return files;
        await pause();
      }
      assert.fail(
        'Restored server revision did not reach the durable client cache',
      );
    };
    const restored = await awaitSharedBuild(shared.artifact.buildId);
    assert.deepEqual(
      readGameBuildIndex(restored).artifacts.find(
        (a) => a.path === shared.artifact.path,
      ),
      shared.artifact,
    );
    await call('restoreHistory', edits.shared.event.id, undefined, 'after');
    await awaitSharedBuild(edits.shared.artifact.buildId);
    console.log(
      'PASS: shared exact dependency reuse and whole source/HTML restore through existing server history',
    );
  }
  if (transfer) await roundTrip(edits.shared ?? shared, 'shared');
  const histories = await call('listHistory');
  assert.ok(
    histories.some(
      (h) =>
        h.status === 'completed' &&
        h.files.some(
          (f) =>
            f.relativePath ===
            `.game-builds/${shared.artifact.buildId}/source/main.js`,
        ),
    ),
  );
  await fs.writeFile(
    `${evidenceDirectory}/package-evidence.json`,
    JSON.stringify(
      {
        local: local.saved.manifest,
        shared: shared.saved.manifest,
        sharedLock: shared.saved.lock,
        ...(editing
          ? {
              edits: Object.fromEntries(
                Object.entries(edits).map(([k, v]) => [k, v.saved.manifest]),
              ),
            }
          : {}),
        ...(transfer ? { transfers } : {}),
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: restart source preservation and same packaged shared-server lease/history path',
  );
} catch (cause) {
  console.error(
    'History:',
    JSON.stringify(await call('listHistory').catch(() => null)),
  );
  console.error('Run:', await call('getActiveRun').catch(() => null));
  console.error(
    'UI:',
    await js('document.body.innerText.slice(-2500)').catch(() => null),
  );
  throw cause;
} finally {
  await stop(true);
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.equal(
    path.dirname(profile),
    path.resolve(process.env.APPDATA, 'Game Canvas', 'test-users'),
  );
  await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
