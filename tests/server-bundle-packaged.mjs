import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { verifyBundleBoundary } from '../scripts/verify-collaboration-bundle.mjs';
import { verifyServerBundle } from './server-bundle-smoke.mjs';
import { sha256 } from '../scripts/build-server-bundle.mjs';

const runtime = path.resolve(
  process.env.GAMEJAM_PACKAGE_DIR ?? 'out/Game Jam!-win32-x64',
  'resources/self-host-runtime',
);
const bundle = path.join(runtime, 'server.mjs');
const manifest = await verifyBundleBoundary(bundle);
assert.equal(
  sha256(await fs.readFile(bundle)),
  sha256(await fs.readFile('out/collaboration-server/server.mjs')),
);
assert.equal(
  sha256(await fs.readFile(path.join(runtime, 'node.exe'))),
  sha256(await fs.readFile(process.execPath)),
);
const result = await verifyServerBundle({
  bundle,
  node: path.join(runtime, 'node.exe'),
  windowsFixture: path.resolve('out/ci/windows-backup'),
});
await fs.writeFile(
  'out/r10-packaged-server.json',
  JSON.stringify(
    { ...result, sha256: manifest.sha256, fingerprint: manifest.fingerprint },
    null,
    2,
  ),
);
console.log('PASS packaged Node + identical server bundle runtime validation');
