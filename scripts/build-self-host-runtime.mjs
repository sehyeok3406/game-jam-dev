import { build } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function buildSelfHostRuntime() {
  if (process.env.GAME_CANVAS_SELF_HOST === '0' || process.platform !== 'win32')
    return;
  if (
    Number(process.versions.node.split('.')[0]) < 24 ||
    path.basename(process.execPath).toLowerCase() !== 'node.exe'
  )
    throw new Error(
      'PC 서버 배포 빌드는 Windows Node.js 24 이상에서 실행하세요.',
    );
  const directory = path.join(root, 'out/self-host-runtime');
  await fs.mkdir(directory, { recursive: true });
  await build({
    configFile: false,
    logLevel: 'warn',
    ssr: { noExternal: true },
    build: {
      ssr: path.join(root, 'src/collaboration-server-entry.ts'),
      target: 'node24',
      outDir: directory,
      emptyOutDir: false,
      rollupOptions: { output: { format: 'es', entryFileNames: 'server.mjs' } },
    },
  });
  await fs.copyFile(process.execPath, path.join(directory, 'node.exe'));
  // Include the runtime license with redistribution.
  const license = path.join(path.dirname(process.execPath), 'LICENSE');
  try {
    await fs.copyFile(license, path.join(directory, 'NODE-LICENSE.txt'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(
      `https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`,
      { signal: AbortSignal.timeout(20_000) },
    );
    if (!response.ok)
      throw new Error('Node.js 런타임 배포 라이선스를 준비하지 못했습니다.');
    await fs.writeFile(
      path.join(directory, 'NODE-LICENSE.txt'),
      await response.text(),
    );
  }
  for (const name of ['connect.ps1', 'diagnostics.ps1', 'host.ps1'])
    await fs.copyFile(
      path.join(root, 'tools/internet-host', name),
      path.join(directory, name),
    );
  await fs.copyFile(
    path.join(root, 'src/features/self-host/bridge.ps1'),
    path.join(directory, 'bridge.ps1'),
  );
  await fs.writeFile(
    path.join(directory, 'runtime-version.json'),
    JSON.stringify({ node: process.versions.node, arch: process.arch }),
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await buildSelfHostRuntime();
