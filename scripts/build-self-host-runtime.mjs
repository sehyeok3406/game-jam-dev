import { buildServerBundle, sha256 } from './build-server-bundle.mjs';
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
  const { bundle } = await buildServerBundle();
  const copyVerified = async (source, destination) => {
    const bytes = await fs.readFile(source);
    const existing = await fs.readFile(destination).catch(() => null);
    if (!existing || sha256(existing) !== sha256(bytes))
      await fs.writeFile(destination, bytes);
  };
  await copyVerified(bundle, path.join(directory, 'server.mjs'));
  await copyVerified(
    bundle + '.manifest.json',
    path.join(directory, 'server.mjs.manifest.json'),
  );
  await copyVerified(process.execPath, path.join(directory, 'node.exe'));
  // Include the runtime license with redistribution.
  const license = path.join(path.dirname(process.execPath), 'LICENSE');
  try {
    await copyVerified(license, path.join(directory, 'NODE-LICENSE.txt'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const previous = await fs
      .readFile(path.join(directory, 'runtime-cache.json'), 'utf8')
      .then(JSON.parse)
      .catch(() => null);
    const cached = await fs
      .readFile(path.join(directory, 'NODE-LICENSE.txt'))
      .catch(() => null);
    const nodeHash = sha256(await fs.readFile(process.execPath));
    if (
      !(
        cached &&
        previous?.node === process.versions.node &&
        previous?.nodeHash === nodeHash &&
        previous?.licenseHash === sha256(cached)
      )
    ) {
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
  }
  for (const name of [
    'connect.ps1',
    'diagnostics.ps1',
    'host.ps1',
    'inspect-ai-state.cjs',
  ])
    await copyVerified(
      path.join(root, 'tools/internet-host', name),
      path.join(directory, name),
    );
  await copyVerified(
    path.join(root, 'src/features/self-host/bridge.ps1'),
    path.join(directory, 'bridge.ps1'),
  );
  await copyVerified(
    path.join(root, 'assets/drawing-third-party-notices.txt'),
    path.join(directory, 'drawing-third-party-notices.txt'),
  );
  const versionFile = path.join(directory, 'runtime-version.json');
  const version = JSON.stringify({
    node: process.versions.node,
    arch: process.arch,
  });
  if ((await fs.readFile(versionFile, 'utf8').catch(() => null)) !== version)
    await fs.writeFile(versionFile, version);
  const files = {};
  for (const name of [
    'server.mjs',
    'drawing-third-party-notices.txt',
    'node.exe',
    'NODE-LICENSE.txt',
    'connect.ps1',
    'diagnostics.ps1',
    'host.ps1',
    'inspect-ai-state.cjs',
    'bridge.ps1',
    'runtime-version.json',
  ])
    files[name] = sha256(await fs.readFile(path.join(directory, name)));
  await fs.writeFile(
    path.join(directory, 'runtime-cache.json'),
    JSON.stringify(
      {
        node: process.versions.node,
        arch: process.arch,
        nodeHash: files['node.exe'],
        licenseHash: files['NODE-LICENSE.txt'],
        files,
      },
      null,
      2,
    ),
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await buildSelfHostRuntime();
