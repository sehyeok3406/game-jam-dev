// Synthetic feasibility cases. These are not generation templates or final art.
const image = `const image = new Image(); image.src = ASSET_URI;
await image.decode();
window.__stage0.image = { width:image.naturalWidth, height:image.naturalHeight };
`;

const pixels = `
function pixelProof(gl, width, height) {
  const bytes = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  const colors = new Set();
  for (let i=0;i<bytes.length;i+=4) colors.add(bytes.slice(i,i+4).join(','));
  return { colors: colors.size, nonBlank: colors.size > 2 };
}
`;

export function fixtures(assetUri) {
  const asset = `const ASSET_URI = ${JSON.stringify(assetUri)};\n`;
  return [
    {
      id: 'canvas-image',
      supported: true,
      source: `${asset}(async()=>{${image}
const canvas=document.createElement('canvas');canvas.width=480;canvas.height=280;document.body.append(canvas);
const ctx=canvas.getContext('2d');let x=40;
function render(){ctx.fillStyle='#f1e6bd';ctx.fillRect(0,0,480,280);ctx.fillStyle='#436c47';ctx.fillRect(0,220,480,60);ctx.drawImage(image,x,100,96,96);}
addEventListener('keydown', e=>{if(e.key==='ArrowRight'){x+=10;render();window.__stage0.moves++;}});
render();window.__stage0.ready=true;window.__stage0.render={nonBlank:ctx.getImageData(50,230,1,1).data[1]>0};
})().catch(window.__stage0Fail);`,
    },
    {
      id: 'pixi-image',
      supported: true,
      source: `import 'pixi.js/unsafe-eval';
import { Application, Graphics, Sprite, Texture } from 'pixi.js';
${asset}${pixels}(async()=>{${image}
const app=new Application();await app.init({width:480,height:280,preference:'webgl',background:0x162f44,preserveDrawingBuffer:true});
document.body.append(app.canvas);
const floor=new Graphics().rect(0,220,480,60).fill(0x4a9272);app.stage.addChild(floor);
const sprite=new Sprite(Texture.from(image));sprite.position.set(40,90);sprite.width=100;sprite.height=100;app.stage.addChild(sprite);
addEventListener('keydown',e=>{if(e.key==='ArrowRight'){sprite.x+=10;window.__stage0.moves++;}});
app.render();window.__stage0.render=pixelProof(app.renderer.gl,480,280);window.__stage0.library='pixi.js';window.__stage0.ready=true;
})().catch(window.__stage0Fail);`,
    },
    {
      id: 'three-image',
      supported: true,
      source: `import * as THREE from 'three';
${asset}${pixels}(async()=>{${image}
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(480,280);document.body.append(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#efd8be');
const camera=new THREE.PerspectiveCamera(45,480/280,0.1,100);camera.position.z=4;
const texture=new THREE.Texture(image);texture.needsUpdate=true;texture.colorSpace=THREE.SRGBColorSpace;
const cube=new THREE.Mesh(new THREE.BoxGeometry(1.6,1.6,1.6),new THREE.MeshBasicMaterial({map:texture}));cube.rotation.set(0.3,0.5,0);scene.add(cube);
const draw=()=>renderer.render(scene,camera);draw();
addEventListener('keydown',e=>{if(e.key==='ArrowRight'){cube.rotation.y+=0.3;draw();window.__stage0.moves++;}});
window.__stage0.render=pixelProof(renderer.getContext(),480,280);window.__stage0.library='three';window.__stage0.ready=true;
})().catch(window.__stage0Fail);`,
    },
    {
      id: 'coop-pixi',
      supported: true,
      multiplayer: true,
      source: `import 'pixi.js/unsafe-eval';
import { Application, Graphics } from 'pixi.js';
(async()=>{
const app=new Application();await app.init({width:480,height:280,preference:'webgl',background:0x163f38,preserveDrawingBuffer:true});document.body.append(app.canvas);
const avatars=new Graphics();app.stage.addChild(avatars);
GameJamMultiplayer.register({
createState({players}){return {players:players.map((p,i)=>({id:p.id,x:80+i*80,y:130}))};},
validateInput(i){return !!i&&typeof i==='object'&&(!('x'in i)||[-1,0,1].includes(i.x));},
step(state,{inputs}){for(const command of inputs){const p=state.players.find(p=>p.id===command.playerId);if(p)p.x+=command.input.x||0;}},
render(state){avatars.clear();for(const p of state.players)avatars.circle(p.x,p.y,25).fill(0xffca65);app.render();window.__stage0.render={nonBlank:state.players.length>0};window.__stage0.ready=true;},
getOutcome(){return null;}
});
addEventListener('keydown',e=>{if(e.key==='ArrowRight'){GameJamMultiplayer.sendInput({x:1});window.__stage0.moves++;}});
})().catch(window.__stage0Fail);`,
    },
    {
      id: 'blob-image',
      supported: true,
      source: `${asset}(async()=>{
const bytes=Uint8Array.from(atob(ASSET_URI.split(',')[1]),c=>c.charCodeAt(0));
const img=new Image();img.src=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));await img.decode();document.body.append(img);
window.__stage0.image={width:img.naturalWidth,height:img.naturalHeight};window.__stage0.ready=true;
})().catch(window.__stage0Fail);`,
    },
    {
      id: 'blob-worker',
      supported: false,
      limitation: 'Player CSP does not permit blob workers',
      source: `const worker=new Worker(URL.createObjectURL(new Blob(['postMessage(42)'],{type:'text/javascript'})));
worker.onmessage=e=>{window.__stage0.value=e.data;window.__stage0.ready=e.data===42;worker.terminate();};worker.onerror=e=>window.__stage0Fail(Error(e.message||'worker failed'));`,
    },
    {
      id: 'wasm-inline',
      supported: false,
      limitation: 'Player CSP does not permit WebAssembly compilation',
      source: `(async()=>{const module=await WebAssembly.instantiate(new Uint8Array([0,97,115,109,1,0,0,0]));window.__stage0.value=!!module.instance;window.__stage0.ready=true;})().catch(window.__stage0Fail);`,
    },
    {
      id: 'dynamic-import',
      supported: true,
      extraFiles: { 'lazy.js': 'export const answer = 42;' },
      source: `import('./lazy.js').then(m=>{window.__stage0.value=m.answer;window.__stage0.ready=m.answer===42;}).catch(window.__stage0Fail);`,
    },
  ];
}

export function htmlDocument(id, js, multiplayer = false) {
  const manifest = multiplayer
    ? '<script type="application/json" id="gamejam-multiplayer">{"version":1,"authority":"host","minPlayers":2,"maxPlayers":2,"sdkVersion":1,"solo":true,"stateVersion":1}</script>'
    : '';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Stage 0 · ${id}</title><style>body{margin:0;background:#f2eee5;color:#203329;font:16px system-ui}header{padding:12px}canvas{display:block}img{width:120px}</style></head><body><header>Stage 0 · ${id}</header>${manifest}<script>
window.__stage0={ready:false,moves:0,errors:[],features:{secureContext:isSecureContext,webgpu:!!navigator.gpu,node:typeof require}};
window.__stage0Fail=e=>{window.__stage0.errors.push(String(e?.message||e));console.error(String(e?.message||e));};
addEventListener('error',e=>window.__stage0.errors.push(e.message||'resource error'),true);
addEventListener('unhandledrejection',e=>window.__stage0.errors.push(String(e.reason)));
</script><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}
