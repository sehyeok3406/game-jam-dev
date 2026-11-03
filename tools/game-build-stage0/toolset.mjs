// Stage-0 packaging experiment only. This is not the production installer.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runProcess, fingerprintTree, sha256 } from './process.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.join(root, 'out/game-build-stage0');
const sourceNode = path.join(
  root,
  'out/Game Jam!-win32-x64/resources/self-host-runtime/node.exe',
);
const npmRoot = path.join(path.dirname(process.execPath), 'node_modules/npm');
const portable = await fs.mkdtemp(
  path.join(os.tmpdir(), 'gamejam-stage0-toolset-'),
);
await fs.copyFile(sourceNode, path.join(portable, 'node.exe'));
await fs.copyFile(
  path.join(path.dirname(sourceNode), 'NODE-LICENSE.txt'),
  path.join(portable, 'NODE-LICENSE.txt'),
);
await fs.cp(npmRoot, path.join(portable, 'npm'), { recursive: true });
const copied = new Set();
async function copyPackage(name) {
  if (copied.has(name)) return;
  copied.add(name);
  const source = path.join(root, 'node_modules', name);
  const pkg = JSON.parse(
    await fs.readFile(path.join(source, 'package.json'), 'utf8'),
  );
  await fs.cp(source, path.join(portable, 'node_modules', name), {
    recursive: true,
  });
  for (const dependency of Object.keys(pkg.dependencies ?? {}))
    await copyPackage(dependency);
}
await copyPackage('rolldown');
await copyPackage('@rolldown/binding-win32-x64-msvc');
await fs.copyFile(
  path.join(root, 'tools/game-build-stage0/runtime.mjs'),
  path.join(portable, 'probe.mjs'),
);
const files = await fingerprintTree(portable);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^path$|^node_path$|^node_options$|^npm_config_|^npm_token$|^node_auth_token$/i.test(
        key,
      ),
  ),
);
env.PATH = '';
const version = await runProcess(
  path.join(portable, 'node.exe'),
  [path.join(portable, 'npm/bin/npm-cli.js'), '--version'],
  { cwd: portable, env },
);
const lock = JSON.parse(
  await fs.readFile(path.join(out, 'dependency-fingerprint.json'), 'utf8'),
);
const replay = path.join(out, 'offline-replay', lock.lockHash.slice(0, 12));
await runProcess(
  path.join(portable, 'node.exe'),
  [
    path.join(portable, 'npm/bin/npm-cli.js'),
    'ci',
    '--offline',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--userconfig',
    path.join(out, 'empty-npmrc'),
    '--globalconfig',
    path.join(out, 'empty-global-npmrc'),
    '--cache',
    path.join(out, 'npm-cache'),
  ],
  { cwd: path.join(replay, 'workspace'), env },
);
await runProcess(
  path.join(portable, 'node.exe'),
  [path.join(portable, 'probe.mjs'), replay],
  { cwd: portable, env },
);
const runtime = JSON.parse(
  await fs.readFile(path.join(replay, 'packaged-runtime-result.json'), 'utf8'),
);
const result = {
  directory: portable,
  node: runtime.runtime.node,
  npm: version.stdout.trim(),
  pathEnvironmentEmpty: true,
  rolldown: JSON.parse(
    await fs.readFile(
      path.join(portable, 'node_modules/rolldown/package.json'),
      'utf8',
    ),
  ).version,
  files: files.length,
  bytes: files.reduce((n, item) => n + item.bytes, 0),
  fingerprint: sha256(JSON.stringify(files)),
  packages: [...copied],
  nodeSha256: sha256(await fs.readFile(path.join(portable, 'node.exe'))),
  offlineInstall: true,
  ...runtime,
};
await fs.writeFile(
  path.join(out, 'portable-toolset.json'),
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    portableToolset: portable,
    bytes: result.bytes,
    node: result.node,
    npm: result.npm,
    builds: result.builds,
  }),
);
