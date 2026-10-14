import { inspectHtml } from '../html-document.ts';
import { readMultiplayerManifest } from './contract.ts';
import { installMultiplayerSdk } from './sdk-runtime.js';

export const MULTIPLAYER_SDK_VERSION = 1;
export function withMultiplayerSdk(
  html: string,
  mode: 'solo' | 'online' | 'validation' = 'solo',
  id = '',
) {
  try {
    if (!readMultiplayerManifest(html)) return html;
  } catch {
    return html;
  } // Imported, unsupported declarations must not crash the canvas.
  const script = `(${installMultiplayerSdk.toString()})(${JSON.stringify({ mode, id }).replaceAll('<', '\\u003c')});`;
  return inspectHtml(html).normalized.replace(
    '<head>',
    `<head><script>${script.replaceAll('</script', '<\\/script')}</script>`,
  );
}
