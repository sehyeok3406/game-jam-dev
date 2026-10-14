import type { BrowserWindow } from 'electron';
import { withMultiplayerSdk } from './sdk.ts';
import { readMultiplayerManifest } from './contract.ts';

/** Run all declared player slots without project access or external networking. */
export async function validateMultiplayerRuntime(
  window: BrowserWindow,
  html: string,
) {
  const count = readMultiplayerManifest(html)?.maxPlayers ?? 2;
  const sources = Array.from({ length: count }, (_, i) =>
    withMultiplayerSdk(html, 'online', `validator-${i}`),
  );
  const harness = `<!doctype html><html><body><script>
  const sources=${JSON.stringify(sources).replaceAll('<', '\\u003c')};
  const count=sources.length,players=Array.from({length:count},(_,i)=>({id:'p'+i,nickname:'Player '+i}));
  window.validation={error:null,registered:0,running:false};
  const ports=[],loaded=new Set(),begun=new Set(),inspections=new Map();let snapshot;
  const send=(i,m)=>ports[i]?.postMessage(m);
  const run=()=>{for(let i=0;i<count;i++)send(i,{type:'run'});window.validation.running=true;};
  const begin=()=>{for(let i=0;i<count;i++)send(i,{type:'begin',context:{selfId:'p'+i,host:i===0,solo:false,players,seed:1}});};
  for(let i=0;i<count;i++){
    const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-scripts');document.body.append(frame);
    frame.onload=()=>{const ch=new MessageChannel();ports[i]=ch.port1;ch.port1.onmessage=e=>{
      const m=e.data;
      if(m.type==='error')window.validation.error=m.message;
      if(m.type==='loaded'){loaded.add(i);window.validation.registered=loaded.size;if(loaded.size===count)begin();}
      if(m.type==='begun'){begun.add(i);if(begun.size===count&&snapshot)run();}
      if(m.type==='input')send(0,{type:'input',playerId:'p'+i,connectionId:'c'+i,sequence:m.sequence,input:m.input});
      if(m.type==='snapshot'){snapshot=m.snapshot;if(new TextEncoder().encode(JSON.stringify(snapshot)).length>32768)window.validation.error='스냅샷이 32KiB를 초과했습니다.';for(let j=1;j<count;j++)send(j,m);if(begun.size===count&&!window.validation.running)run();}
      if(m.type==='inspection'){inspections.set(i,m.snapshot);if(inspections.size===count){window.validation.equal=[...inspections.values()].every(value=>JSON.stringify(inspections.get(0)?.state)===JSON.stringify(value?.state));window.validation.done=true;}}
    };ch.port1.start();frame.contentWindow.postMessage({type:'gamejam:connect',id:'validator-'+i},'*',[ch.port2]);};frame.srcdoc=sources[i];
  }
  const endCheck=setInterval(()=>{if(!window.validation.running)return;clearInterval(endCheck);setTimeout(()=>{for(let i=0;i<count;i++)send(i,{type:'pause'});setTimeout(()=>{for(let i=0;i<count;i++)send(i,{type:'inspect',id:'end'});},80);},700);},50);
  </script></body></html>`;
  await window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(harness)}`,
  );
  for (let n = 0; n < 100; n++) {
    const result =
      await window.webContents.executeJavaScript('window.validation');
    if (result?.error)
      throw Error(
        `[GC-MP-004] 공동 실행 오류: ${String(result.error).slice(0, 300)}`,
      );
    if (result?.done) {
      if (result.registered !== count || !result.running || !result.equal)
        throw Error(
          '[GC-MP-004] 참가 게임들의 초기화·공유 상태가 일치하지 않습니다.',
        );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw Error('[GC-MP-004] 공동 실행 초기화 시간이 초과되었습니다.');
}
