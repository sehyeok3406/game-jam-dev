import { build } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
process.env.GAME_CANVAS_SELF_HOST = '0';
async function codeIn(directory) {
  let code = '';
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) code += await codeIn(target);
    else if (/\.(cjs|mjs|js)$/.test(entry.name))
      code += await fs.readFile(target, 'utf8');
  }
  return code;
}
for (const [name, entry] of [
  ['main', 'src/main.ts'],
  ['preload', 'src/preload.ts'],
]) {
  const directory = `out/qa/self-host-disabled/${name}`;
  await build({
    configFile: `vite.${name}.config.mts`,
    logLevel: 'error',
    define: {
      __SELF_HOST_ENABLED__: 'false',
      __dirname: JSON.stringify(path.resolve(directory)),
      MAIN_WINDOW_VITE_DEV_SERVER_URL: 'null',
      MAIN_WINDOW_VITE_NAME: '"main_window"',
    },
    build: {
      ssr: entry,
      outDir: directory,
      rollupOptions: {
        external: ['electron', 'electron-squirrel-startup'],
        output: { format: 'cjs', entryFileNames: 'entry.cjs' },
      },
    },
  });
  const code = await codeIn(directory);
  for (const capability of [
    'self-host:run',
    'self-host:prompt',
    'cloudflared-windows-',
  ])
    assert.ok(
      !code.includes(capability),
      `${name}: ${capability} must be removed`,
    );
  assert.ok(
    code.includes('projects:connection-apply'),
    `${name}: reconnect must remain available`,
  );
}
const renderer = 'out/qa/self-host-disabled/renderer';
await build({
  configFile: 'vite.renderer.config.mts',
  logLevel: 'error',
  define: { __SELF_HOST_ENABLED__: 'false' },
  build: { outDir: renderer },
});
const code = await codeIn(renderer);
assert.ok(
  !code.includes('연결 도구 준비') &&
    !code.includes('서버 계속 실행 · 숨겨진 아이콘으로 관리'),
);
console.log(
  'PASS: disabled builds omit PC-host IPC and management UI, retaining shared reconnect',
);
