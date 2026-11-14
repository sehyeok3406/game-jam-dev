import type { BrowserWindow } from 'electron';
/** Transfer large HTML through the renderer IPC, never through the navigation URL. */
export async function loadValidationFrame(
  window: BrowserWindow,
  html: string,
  channel: string,
  local = false,
  waitForProjectAssets = false,
) {
  const track = waitForProjectAssets
    ? `
      const pending = new Set();
      function track(owner, name) {
        const original = owner[name];
        owner[name] = function (...args) {
          const result = Reflect.apply(original, this, args);
          pending.add(result);
          const done = () => pending.delete(result);
          result.then(done, done);
          return result;
        };
      }
      track(window, 'fetch');
      track(Response.prototype, 'arrayBuffer');
      track(Response.prototype, 'blob');
      track(window, 'createImageBitmap');
      async function settle() {
        do {
          await Promise.allSettled([...pending]);
          await new Promise(resolve => setTimeout(resolve, 100));
        } while (pending.size);
      }
    `
    : '';
  const ready = `<script>(()=>{${track}window.addEventListener('error',e=>{if(e.target!==window&&e.target instanceof Element)console.error('리소스 로딩 실패: '+e.target.tagName);},true);window.addEventListener('load',async()=>{try{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode()));${waitForProjectAssets ? 'await settle();' : ''}}catch(e){console.error('리소스 초기화 실패: '+String(e));}parent.postMessage({type:'gamejam-validation-ready',channel:${JSON.stringify(channel)}},'*');},{once:true});})();</script>`;
  const source = html.replace(/<head([^>]*)>/i, `<head$1>${ready}`);
  await window.loadURL(
    'data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Chtml%3E%3Cbody%3E%3C%2Fbody%3E%3C%2Fhtml%3E',
  );
  let frameSource: string;
  if (local && source.length > 512 * 1024) {
    await window.webContents.executeJavaScript(
      'window.validationHtmlParts = [];',
    );
    for (let offset = 0; offset < source.length; offset += 512 * 1024) {
      const chunk = source.slice(offset, offset + 512 * 1024);
      await window.webContents.executeJavaScript(
        `window.validationHtmlParts.push(${JSON.stringify(chunk)});`,
      );
    }
    frameSource = "window.validationHtmlParts.join('')";
  } else frameSource = JSON.stringify(source);
  await window.webContents.executeJavaScript(`new Promise(resolve=>{
    const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-scripts');frame.style='border:0;width:100vw;height:100vh';
    const ready=event=>{if(event.source!==frame.contentWindow||event.data?.type!=='gamejam-validation-ready'||event.data.channel!==${JSON.stringify(channel)})return;window.removeEventListener('message',ready);resolve(true);};
    window.addEventListener('message',ready);document.body.append(frame);frame.srcdoc=${frameSource};
    delete window.validationHtmlParts;
  })`);
}
