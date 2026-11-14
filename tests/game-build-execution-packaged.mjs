// Production IPC/executor/validator/storage with a local CLI fixture. No paid AI calls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  root,
  profile,
  game,
  boot,
  stop,
  js,
  send,
  pause,
  wait,
  appProcessId,
  packageFrameSessions,
} from './helpers/packaged-canvas.mjs';
import { gamejamTaskInput } from '../src/gamejam-request.ts';
import { applyChanges, captureProject } from '../src/project-store.ts';
import {
  appendGameBuild,
  readGameBuildIndex,
  readGameBuild,
} from '../src/core/projects/game-build.ts';
import {
  gameBuildCodec,
  localGameBuildCodec,
} from '../src/adapters/node/game-build-codec.ts';
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
const largeLocal = process.env.GAMEJAM_BUILD_LARGE_LOCAL === '1';
const glbPath = process.env.GAMEJAM_BUILD_TEST_GLB;
const mediaPaths = [
  'GAMEJAM_BUILD_TEST_AUDIO',
  'GAMEJAM_BUILD_TEST_FBX',
  'GAMEJAM_BUILD_TEST_OBJ',
  'GAMEJAM_BUILD_TEST_BLEND',
]
  .map((key) => process.env[key])
  .filter(Boolean);
const codec = localGameBuildCodec;
const evidenceDirectory = transfer
  ? 'out/game-build-stage6'
  : editing
    ? 'out/game-build-stage5'
    : largeLocal
      ? 'out/large-local-html'
      : glbPath
        ? 'out/local-glb-game-build'
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
 const three=args.some(a=>['build-three','edit-three','new-three','add-three','propose-three','glb-three','media-three'].includes(a));
 const threeSource="import {Vector2} from 'three';const movement=new Vector2(3,4);if(movement.length()!==5)throw Error('Three API failed');";
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
    let source=fs.readFileSync('source/main.js','utf8');
    if(args.includes('add-three'))source=threeSource+source;
    if(args.includes('remove-library'))source=source.replace(threeSource,'');
    fs.writeFileSync('source/main.js',args.includes('fail-local')?"import 'unprepared-engine';":source.replace(/dataset.lives='[0-9]+'/g,"dataset.lives='9'").replace(/목숨 7개/g,'목숨 9개')+";document.body.dataset.edit='yes';document.querySelector('p').textContent='← → 이동 · 목숨 9개 · 전투 금지';");
  }else{
  fs.mkdirSync('source');
  fs.writeFileSync('source/main.js',(three?threeSource:'')+"import assets from 'gamejam:assets';import './style.css';document.body.dataset.lives='7';const c=document.querySelector('canvas'),g=c.getContext('2d');let x=90;function draw(){g.fillStyle='#142236';g.fillRect(0,0,480,280);g.fillStyle='#88e0ad';g.fillRect(x,140,35,35);g.fillStyle='white';g.font='22px sans-serif';g.fillText('목숨 7개 · 전투 없는 숲',28,40);}draw();document.addEventListener('keydown',e=>{if(e.key==='ArrowRight')x+=10;if(e.key==='ArrowLeft')x-=10;draw();});document.querySelector('#hero').src=assets.hero;");
  fs.writeFileSync('source/style.css','body{margin:0;background:#0e1828;color:white;font-family:sans-serif;display:grid;place-content:center;height:100vh}canvas{border:2px solid #88e0ad}img{width:24px;height:24px}');
  fs.writeFileSync('source/index.html','<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>숲의 이동</title><script type="module" src="./main.js"></script></head><body><h1>숲의 이동</h1><canvas width="480" height="280"></canvas><img id="hero" src="gamejam:asset/hero"><p>← → 이동 · 목숨 7개 · 전투 금지</p></body></html>');
  fs.writeFileSync('source-plan.json',JSON.stringify({version:1,entry:'main.js',html:'index.html',files:['main.js','style.css','index.html'],assets:[{key:'hero',path:'assets/images/hero.gif'}]}));
  if(args.includes('glb-three')){
    const model=ctx.projectAssets.find(a=>a.kind==='glb'), plan=JSON.parse(fs.readFileSync('source-plan.json','utf8'));
    if(fs.existsSync(model.path))throw Error('GLB bytes must stay in the project');
    plan.assets.push({key:'robot',path:model.path});
    fs.writeFileSync('source-plan.json',JSON.stringify(plan));
    fs.appendFileSync('source/main.js', ${JSON.stringify(`
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Scene, PerspectiveCamera, WebGLRenderer, Box3, Vector3, AmbientLight, DirectionalLight, Color, LoadingManager } from 'three';
const manager = new LoadingManager();
manager.onError = () => console.error('Model failed to load');
void new GLTFLoader(manager).loadAsync(assets.robot).then((robot) => {
const box = new Box3().setFromObject(robot.scene);
const center = box.getCenter(new Vector3()), size = box.getSize(new Vector3()).length();
const renderer = new WebGLRenderer();
renderer.setSize(320,240);
document.body.append(renderer.domElement);
const scene = new Scene();
scene.background = new Color(0x20242b);
scene.add(robot.scene, new AmbientLight(0xffffff, 1.5));
const light = new DirectionalLight(0xffffff, 3);
light.position.set(3,5,8);
scene.add(light);
const camera = new PerspectiveCamera(45, 320/240, size/1000, size*20);
camera.position.copy(center).add(new Vector3(0,0,size*1.4));
camera.lookAt(center);
renderer.render(scene,camera);
if (!renderer.info.render.triangles) throw Error('No model triangles drawn');
document.body.dataset.model = String(renderer.info.render.triangles);
});
`)});
  }
  if(args.includes('media-three')){
    const plan=JSON.parse(fs.readFileSync('source-plan.json','utf8'));
    if (!ctx.projectAssets.some(a=>a.kind==='image')) throw Error('missing image reference');
    for(const asset of ctx.projectAssets){
      if(fs.existsSync(asset.path)) throw Error('original bytes must stay in the project');
      if(asset.kind!=='image') plan.assets.push({key:asset.kind,path:asset.path});
    }
    fs.writeFileSync('source-plan.json',JSON.stringify(plan));
    fs.writeFileSync('source/style.css',fs.readFileSync('source/style.css','utf8')+'h1{background-image:url("gamejam:asset/hero")}');
    fs.writeFileSync('source/index.html',fs.readFileSync('source/index.html','utf8').replace('</body>','<button id="listen">Play</button><audio id="sound" preload="metadata" src="gamejam:asset/audio"></audio></body>'));
    fs.appendFileSync('source/main.js', ${JSON.stringify(`
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AmbientLight, LoadingManager, OrthographicCamera, Scene, WebGLRenderer } from 'three';
const sound=document.querySelector('#sound');
document.querySelector('#listen').onclick=()=>{sound.currentTime=0.25;void sound.play();};
sound.addEventListener('timeupdate',()=>document.body.dataset.sound=String(sound.currentTime));
sound.addEventListener('loadedmetadata',()=>document.body.dataset.duration=String(sound.duration));
const manager=new LoadingManager().setURLModifier(url=>url===assets.fbx || /^(?:data:|blob:)/.test(url)?url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/X2QAAAAASUVORK5CYII=');
const loadObj = async () => {
  const material = await new MTLLoader().loadAsync(assets.obj + '/materials/hero%20body.mtl');
  const model = await new OBJLoader().setMaterials(material).loadAsync(assets.obj);
  const map = model.children.find(child => child.isMesh)?.material.map;
  for (let i=0; i<100 && !map?.image?.naturalWidth; i++) await new Promise(resolve => setTimeout(resolve, 20));
  if (map?.image?.naturalWidth !== 2) throw Error('OBJ texture was not decoded');
  const scene = new Scene();
  scene.add(model, new AmbientLight(0xffffff, 3));
  const camera = new OrthographicCamera(0, 1, 1, 0, 0.1, 10);
  camera.position.z = 2;
  const renderer = new WebGLRenderer();
  renderer.setSize(32, 32);
  renderer.render(scene, camera);
  const gl = renderer.getContext(), pixel = new Uint8Array(4);
  gl.readPixels(6, 6, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  if (!renderer.info.render.triangles || (pixel[0] === 0 && pixel[1] === 0)) throw Error('Textured OBJ was not rendered');
  document.body.append(renderer.domElement);
  document.body.dataset.objTexture = String(map.image.naturalWidth);
  return model.children.length;
};
void Promise.all([
  new FBXLoader(manager).loadAsync(assets.fbx).then(g=>{if(!g.animations.length)throw Error('FBX animation missing');return g.animations.length;}),
  loadObj(),
  new GLTFLoader().loadAsync(assets.blend).then(g=>{if(!g.scene.children.length)throw Error('Blender export empty');return g.scene.children.length;}),
]).then(counts=>document.body.dataset.media=counts.join(','));
`)});
  }
  if(args.includes('build-large')){
    const plan=JSON.parse(fs.readFileSync('source-plan.json','utf8'));
    for(let n=0;n<9;n++){
      const filename='large-'+n+'.js';
      plan.files.push(filename);
      fs.writeFileSync('source/'+filename,'globalThis.largeFixture ??= []; globalThis.largeFixture.push('+JSON.stringify(String(n).repeat(1500000))+');');
      fs.appendFileSync('source/main.js','\\nimport "./'+filename+'";');
    }
    fs.writeFileSync('source-plan.json',JSON.stringify(plan));
  }
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
    .filter((doc) =>
      [
        'project',
        'hero-card',
        ...(options.modelIds ?? (options.modelId ? [options.modelId] : [])),
      ].includes(doc.id),
    )
    .map((doc) => doc.relativePath);
  assert.equal(
    inputs.length,
    2 + (options.modelIds?.length ?? (options.modelId ? 1 : 0)),
  );
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
        ...(options.dependencyChanges
          ? { dependencyChanges: options.dependencyChanges }
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
  if (activeRoot !== game) {
    await wait(
      `window.gameCanvas.listPreviews().then((items) => items.some((item) => item.relativePath === ${JSON.stringify(outputPath)} && item.build?.kind === 'source' && item.build.buildId !== ${JSON.stringify(options.previous?.artifact.buildId ?? null)}))`,
    );
    // Let Windows finish replacing the cache before this test opens its files.
    await pause();
  }
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
        saved = readGameBuild(
          files,
          artifact.buildId,
          activeRoot === game ? localGameBuildCodec : gameBuildCodec,
        );
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
    if (!options.dependencyChanges)
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
  const hero = saved.manifest.assets[0];
  assert.equal(
    hero.sha256,
    hero.kind === 'image'
      ? createHash('sha256')
          .update(Buffer.from(image.split(',')[1], 'base64'))
          .digest('hex')
      : codec.digest(image),
  );
  if (modelId.includes('three') || glbPath || mediaPaths.length > 0)
    assert.equal(
      saved.lock.packages.find((p) => p.name === 'three').version,
      '0.187.0',
    );
  else assert.equal(saved.lock.packages.length, 0);
  assert.equal(
    files[artifact.path].split(image).length - 1,
    hero.kind === 'image' ? 0 : 1,
  );
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
async function useFileDialog(
  pending,
  destination,
  cancel = false,
  open = false,
) {
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
      ...(open ? ['-Open'] : []),
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
  return useFileDialog(pending, destination, cancel);
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
async function verifyLargeLocalHtml() {
  const local = await execute('build-large');
  assert.ok(local.saved.manifest.output.bytes > 12_000_000);
  const relative = local.artifact.path;
  const previewState = (file) =>
    js(
      `window.gameCanvas.listPreviews().then(items=>{const p=items.find(item=>item.relativePath===${JSON.stringify(file)});return p&&{kind:p.build.kind, length:p.content.length};})`,
    );
  assert.equal((await previewState(relative)).kind, 'source');
  await execute('fail-local', { previous: local, expectFailure: true });
  await call('restoreHistory', local.event.id, undefined, 'before');
  assert.equal((await captureProject(game))[relative], undefined);
  await call('restoreHistory', local.event.id, undefined, 'after');
  assert.equal((await captureProject(game))[relative], local.files[relative]);

  const destination = path.join(root, 'large-export.html');
  assert.equal(await nativeExport(relative, destination), true);
  assert.equal(await fs.readFile(destination, 'utf8'), local.files[relative]);
  console.log('PASS: native export preserves large HTML bytes');
  const imported = await useFileDialog(
    js(
      `window.gameCanvas.getWorkspace().then(w=>window.gameCanvas.importFiles({scope:w.saveScope,contextId:w.clipboardContextId,x:160,y:200,imagePurpose:'asset'}))`,
    ),
    destination,
    false,
    true,
  );
  const importedPath = imported.find((d) => d.htmlSource)?.htmlSource;
  assert.ok(importedPath, 'native picker imports a large HTML file');
  assert.equal(
    await fs.readFile(path.join(game, importedPath), 'utf8'),
    local.files[relative],
  );
  const nativeInput = await send('Runtime.evaluate', {
    expression:
      'document.body.appendChild(Object.assign(document.createElement("input"),{id:"large-drop-fixture",type:"file"}))',
  });
  await send('DOM.setFileInputFiles', {
    files: [destination],
    objectId: nativeInput.result.objectId,
  });
  await js(`(() => {
    const input = document.querySelector('#large-drop-fixture');
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(input.files[0]);
    document.querySelector('.react-flow').dispatchEvent(new DragEvent('drop',{bubbles:true,clientX:460,clientY:380,dataTransfer}));
    input.remove();
  })()`);
  await wait(
    'window.gameCanvas.listDocuments().then(d=>d.filter(x=>x.htmlSource?.endsWith("/large-export.html")).length===2)',
  );

  const target = await call('createProject', {
    mode: 'local',
    name: '대형 HTML 복사 대상',
    parent: root,
  });
  const entry = (await call('listProjects')).find(
    (p) => p.root === target.root,
  );
  const originalEntry = (await call('listProjects')).find(
    (p) => p.root === game,
  );
  await call('openProject', originalEntry.id);
  const workspace = await call('getWorkspace');
  const copied = await call('copySelectionToProject', {
    session: workspace.session,
    targetId: entry.id,
    requestId: randomUUID(),
    canvasId: 'default',
    selection: {
      canvasId: 'default',
      documents: [],
      sections: [],
      previews: [relative, importedPath],
      drawings: [],
    },
  });
  assert.equal(copied.count, 2);
  const copiedHtml = copied.paths.filter((p) => p.endsWith('.html'));
  assert.equal(copiedHtml.length, 2);
  for (const file of copiedHtml)
    assert.equal(
      await fs.readFile(path.join(target.root, file), 'utf8'),
      local.files[relative],
    );

  // Install a valid >64MB revision using the same manifest rules, then reopen it.
  const artifact = { ...local.artifact, buildId: randomUUID() };
  const prefix = `.game-builds/${artifact.buildId}`;
  const oldPrefix = `.game-builds/${local.artifact.buildId}/`;
  const files = await captureProject(game);
  const html = files[relative].replace(
    '</body>',
    `<!--${'x'.repeat(65_000_000)}--></body>`,
  );
  const manifest = {
    ...local.saved.manifest,
    buildId: artifact.buildId,
    output: {
      pathAtCreation: relative,
      bytes: codec.byteLength(html),
      sha256: codec.digest(html),
    },
  };
  const bundle = Object.fromEntries(
    Object.entries(files)
      .filter(([file]) => file.startsWith(oldPrefix))
      .map(([file, content]) => [
        `${prefix}/${file.slice(oldPrefix.length)}`,
        content,
      ]),
  );
  bundle[`${prefix}/manifest.json`] = JSON.stringify(manifest);
  const candidate = appendGameBuild(files, bundle, artifact, html, codec);
  await stop(true);
  await applyChanges(
    game,
    files,
    Object.fromEntries(
      [...Object.keys(bundle), '.game-builds/index.json', relative].map(
        (file) => [file, candidate[file]],
      ),
    ),
  );
  await boot(true, env);
  assert.deepEqual(await previewState(relative), {
    kind: 'source',
    length: html.length,
  });
  const preview = `document.querySelector(${JSON.stringify(`[data-id="preview:${relative}"]`)})`;
  await wait(`!!${preview}`);
  await js(`${preview}.querySelector('.file-node-surface--html')?.click()`);
  await wait(`!!${preview}.querySelector('iframe')`);
  await send('Page.enable');
  await send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });
  const id = (await send('DOM.getDocument')).root.nodeId;
  const { nodeId } = await send('DOM.querySelector', {
    nodeId: id,
    selector: `[data-id="preview:${relative}"] iframe`,
  });
  const { node } = await send('DOM.describeNode', { nodeId });
  let world;
  try {
    world = await send('Page.createIsolatedWorld', {
      frameId: node.frameId,
      worldName: 'large-local-html-check',
    });
  } catch {
    // Chromium may place an opaque-origin preview in an out-of-process frame.
  }
  let played = false;
  for (let n = 0; n < 100 && !played; n++) {
    for (const sessionId of world ? [undefined] : packageFrameSessions()) {
      const result = await send(
        'Runtime.evaluate',
        {
          expression:
            "document.body?.dataset.lives==='7' && [...document.body.childNodes].some(node=>node.nodeType===8 && node.length===65000000)",
          returnByValue: true,
          ...(world ? { contextId: world.executionContextId } : {}),
        },
        sessionId,
      ).catch(() => undefined);
      if (result?.result?.value === true) played = true;
    }
    if (!played) await pause();
  }
  assert.ok(played, 'reopened >64MB canvas frame runs the game script');
  console.log(
    'PASS: large HTML build, history restore, native export/picker/drop, local copy and >64MB revision after restart',
  );
}
async function dropMedia(files) {
  const nativeInput = await send('Runtime.evaluate', {
    expression:
      'document.body.appendChild(Object.assign(document.createElement("input"),{id:"glb-drop-fixture",type:"file",multiple:true}))',
  });
  await send('DOM.setFileInputFiles', {
    files: files.map((file) => path.resolve(file)),
    objectId: nativeInput.result.objectId,
  });
  await js(`(() => {
    const input = document.querySelector('#glb-drop-fixture');
    const dataTransfer = new DataTransfer();
    for(const file of input.files) dataTransfer.items.add(file);
    document.querySelector('.react-flow').dispatchEvent(new DragEvent('drop',{bubbles:true,clientX:460,clientY:380,dataTransfer}));
    input.remove();
  })()`);
}
async function verifyLocalGlb() {
  await dropMedia([glbPath]);
  await wait('window.gameCanvas.listDocuments().then(d=>d.some(x=>x.model))');
  const card = (await call('listDocuments')).find((d) => d.model);
  const file = path.join(game, card.model.path);
  const original = await fs.stat(file);
  assert.equal(original.size, (await fs.stat(glbPath)).size);
  const first = await execute('glb-three', { modelId: card.id });
  assert.equal(first.saved.manifest.assets[1].path, card.model.path);
  assert.equal(first.saved.manifest.assets[1].bytes, original.size);
  const second = await execute('glb-three-edit', { previous: first });
  assert.deepEqual(second.saved.manifest.assets, first.saved.manifest.assets);
  assert.deepEqual(await fs.readdir(path.dirname(file)), [path.basename(file)]);
  const outputs = await fs.readdir(path.join(game, 'output'), {
    recursive: true,
  });
  assert.ok(outputs.every((name) => !name.endsWith('.glb')));
  await call('deleteDocument', {
    documentId: card.id,
    relativePath: card.relativePath,
  });
  assert.equal((await fs.stat(file)).size, original.size);
  await call('restoreHistory', second.event.id, undefined, 'before');
  assert.equal(
    (await captureProject(game))[first.artifact.path],
    first.files[first.artifact.path],
  );
  await stop(true);
  await boot(true, env);
  const relative = first.artifact.path;
  const selector = `[data-id="preview:${relative}"]`;
  const preview = `document.querySelector(${JSON.stringify(selector)})`;
  await wait(`!!${preview}`);
  await js(`${preview}.querySelector('.file-node-surface--html')?.click()`);
  await wait(`!!${preview}.querySelector('iframe')`);
  await send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });
  let triangles;
  for (let n = 0; n < 120 && !triangles; n++) {
    for (const sessionId of packageFrameSessions()) {
      const value = await send(
        'Runtime.evaluate',
        {
          expression: 'Number(document.body?.dataset.model)',
          returnByValue: true,
        },
        sessionId,
      ).catch(() => undefined);
      if (value?.result?.value > 0) triangles = value.result.value;
    }
    if (!triangles) await pause();
  }
  assert.ok(
    triangles,
    'restored game renders real GLB triangles inside its canvas preview',
  );
  const urls = await call(
    'readGameAssetUrls',
    relative,
    first.artifact.buildId,
  );
  const stale = urls.robot;
  assert.match(stale, /^gamejam-media:\/\/game-assets\//);
  await assert.rejects(
    call('readGameAssetUrls', relative, second.artifact.buildId),
    /게임 버전이 변경되었습니다/,
  );
  await assert.rejects(call('exportPreviewHtml', relative), /프로젝트 에셋/);
  await call('goHome');
  assert.equal(
    await js(`fetch(${JSON.stringify(stale)}).then(r=>r.ok,()=>false)`),
    false,
  );
  console.log(
    'PASS: GLB source, two revisions, one active file, card deletion, restore, restart and actual WebGL rendering',
    original.size,
    triangles,
  );
}
async function verifyLocalMedia() {
  assert.equal(mediaPaths.length, 4);
  const objDirectory = path.join(root, 'textured-obj');
  const objPath = path.join(objDirectory, 'triangle.obj');
  const mtl = path.join(objDirectory, 'materials', 'hero body.mtl');
  const texture = path.join(objDirectory, 'textures', 'hero image.png');
  await fs.mkdir(path.dirname(mtl), { recursive: true });
  await fs.mkdir(path.dirname(texture), { recursive: true });
  await fs.writeFile(
    objPath,
    'mtllib materials/hero body.mtl\no Triangle\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nusemtl Hero\nf 1/1 2/2 3/3\n',
  );
  await fs.writeFile(
    mtl,
    'newmtl Hero\nKd 0.4 0.8 0.1\nmap_Kd ../textures/hero image.png\n',
  );
  await fs.writeFile(
    texture,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8DA8J8BAAf/Af8Bf4mnAAAAAElFTkSuQmCC',
      'base64',
    ),
  );
  await dropMedia([
    ...mediaPaths.slice(0, 2),
    objPath,
    ...mediaPaths.slice(3),
    mtl,
  ]);
  await wait(
    'window.gameCanvas.listDocuments().then(d=>d.filter(x=>x.model||x.audio).length===4)',
  );
  const documents = await call('listDocuments');
  const cards = documents.filter((doc) => doc.model || doc.audio);
  const first = await execute('media-three', {
    modelIds: cards.map((card) => card.id),
  });
  const second = await execute('media-three-edit', { previous: first });
  const obj = first.saved.manifest.assets.find((asset) => asset.kind === 'obj');
  assert.deepEqual(
    obj.resources?.map((file) => file.name),
    ['materials/hero body.mtl', 'textures/hero image.png'],
  );
  assert.deepEqual(
    first.saved.manifest.assets.map((asset) => asset.kind).sort(),
    ['audio', 'blend', 'fbx', 'image', 'obj'],
  );
  const derived = first.saved.manifest.assets.find(
    (asset) => asset.kind === 'blend',
  ).runtime;
  const models = path.join(game, path.dirname(derived.path));
  assert.deepEqual(
    (await fs.readdir(models)).filter((name) => name.endsWith('.glb')),
    [path.basename(derived.path)],
  );
  await wait('window.gameCanvas.getActiveRun().then(run=>!run)');
  for (const card of [
    ...cards,
    documents.find((doc) => doc.id === 'hero-card'),
  ])
    await call('deleteDocument', {
      documentId: card.id,
      relativePath: card.relativePath,
    });
  for (const asset of first.saved.manifest.assets)
    assert.equal(
      (await fs.stat(path.join(game, asset.path))).size,
      asset.bytes,
    );
  for (const file of obj.resources)
    assert.equal((await fs.stat(path.join(game, file.path))).size, file.bytes);
  await call('restoreHistory', second.event.id, undefined, 'before');
  await stop(true);
  await boot(true, env);
  const relative = first.artifact.path;
  const urls = await call(
    'readGameAssetUrls',
    relative,
    first.artifact.buildId,
  );
  assert.equal(
    await js(
      `fetch(${JSON.stringify(urls.obj + '/textures/other.png')}).then(r=>r.status,()=>404)`,
    ),
    404,
  );
  assert.deepEqual(
    await js(
      `fetch(${JSON.stringify(urls.audio)},{headers:{range:'bytes=2-7'}}).then(async r=>[r.status,r.headers.get('content-type'),(await r.arrayBuffer()).byteLength])`,
    ),
    [206, 'audio/mpeg', 6],
  );
  const preview = `document.querySelector(${JSON.stringify(`[data-id="preview:${relative}"]`)})`;
  await wait(`!!${preview}`);
  await js(`${preview}.querySelector('.file-node-surface--html')?.click()`);
  await wait(`!!${preview}.querySelector('iframe')`);
  await send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });
  let played = false;
  for (let n = 0; n < 150 && !played; n++) {
    for (const sessionId of packageFrameSessions()) {
      const info = await send(
        'Runtime.evaluate',
        {
          expression: `(()=>{if(!document.body?.dataset.media)return false;const button=document.querySelector('#listen');const audio=document.querySelector('#sound');if(audio.paused)button.click();return document.body.dataset.objTexture==='2'&&document.querySelector('img').naturalWidth===1&&getComputedStyle(document.querySelector('h1')).backgroundImage.includes('gamejam-media:')&&audio.duration>0&&audio.currentTime>0.30;})()`,
          userGesture: true,
          returnByValue: true,
        },
        sessionId,
      ).catch(() => undefined);
      if (info?.result?.value === true) played = true;
    }
    if (!played) await pause();
  }
  assert.ok(
    played,
    'restored game displays the original image, plays audio, and loads FBX animations, OBJ and Blender geometry',
  );
  console.log(
    'PASS: image/CSS, audio ranges, FBX animation, OBJ materials/textures, BLEND, deletion, restore and restart',
  );
}
async function verifyExistingBuilds() {
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
    if (process.env.GAMEJAM_PUBLIC_BUILD === '1') {
      const proposed = await execute('propose-three', {
        previous: edits.local,
        expectFailure: true,
      });
      assert.equal(proposed.event.failure.code, 'GC-AI-011');
      assert.deepEqual(
        proposed.event.failure.details.suggestedLibraries.map(
          (library) => library.name,
        ),
        ['three'],
      );
      await js(`document.querySelector('[aria-label="gamejam!"]').click()`);
      await wait(
        `Array.from(document.querySelectorAll('.gamejam-request-history button')).some((button) => button.textContent.includes('최근 작업 불러오기'))`,
      );
      await js(
        `Array.from(document.querySelectorAll('.gamejam-request-history button')).find((button) => button.textContent.includes('최근 작업 불러오기')).click()`,
      );
      await wait(
        `!!document.querySelector('[data-gamejam-page="2"]:not([hidden]) .ai-dependency-changes')`,
      );
      await js(
        `Array.from(document.querySelectorAll('.ai-dependency-changes button')).find((button) => button.textContent === 'three 추가').click()`,
      );
      assert.ok(
        await js(
          `document.querySelector('.gamejam-review').textContent.includes('three 추가')`,
        ),
      );
      await js(
        `document.querySelector('.ai-request-dialog > footer button').click()`,
      );
      await wait(`!document.querySelector('.ai-request-dialog')`);
      const added = await execute('add-three', {
        previous: edits.local,
        mode: 'new',
        dependencyChanges: [
          { action: 'add', name: 'three', version: '0.187.0' },
        ],
      });
      assert.deepEqual(Object.keys(added.saved.lock.roots), ['three']);
      assert.deepEqual(
        readGameBuild(added.files, local.artifact.buildId, codec).lock,
        local.saved.lock,
      );
    }
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
  if (transfer)
    await assert.rejects(
      call('exportPreviewHtml', (edits.local ?? local).artifact.path),
      /프로젝트 에셋/,
    );
  await stop(true);
  await boot(true, env);
  const reopened = await captureProject(game);
  assert.equal(
    readGameBuild(reopened, local.artifact.buildId, codec).sources['main.js'],
    local.saved.sources['main.js'],
  );
  const internal = await call('startLocalCollaborationServer');
  // Local revisions refer to media served from the PC. Seed a separate source
  // project so the shared scenario exercises portable dependencies and assets.
  const sharedSource = await call('createProject', {
    name: '공동 게임 빌드 검사',
    mode: 'local',
    parent: root,
  });
  assert.ok(sharedSource.root?.startsWith(root + path.sep));
  await applyChanges(
    sharedSource.root,
    await captureProject(sharedSource.root),
    {
      'project.md': reopened['project.md'],
      'ideas/hero.md': reopened['ideas/hero.md'],
      'assets/images/hero.gif': reopened['assets/images/hero.gif'],
    },
  );
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
      await wait(
        `window.gameCanvas.listPreviews().then((items) => items.some((item) => item.relativePath === ${JSON.stringify(shared.artifact.path)} && item.build?.buildId === ${JSON.stringify(buildId)}))`,
      );
      await pause();
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
    if (process.env.GAMEJAM_PUBLIC_BUILD === '1') {
      const removed = await execute('remove-library', {
        previous: edits.shared,
        dependencyChanges: [{ action: 'remove', name: 'three' }],
      });
      assert.deepEqual(Object.keys(removed.saved.lock.roots), []);
      assert.deepEqual(
        readGameBuild(
          removed.files,
          edits.shared.artifact.buildId,
          gameBuildCodec,
        ).lock,
        edits.shared.saved.lock,
      );
    }
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
}
try {
  await boot(true, env);
  if (mediaPaths.length) await verifyLocalMedia();
  else if (glbPath) await verifyLocalGlb();
  else if (largeLocal) await verifyLargeLocalHtml();
  else await verifyExistingBuilds();
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
