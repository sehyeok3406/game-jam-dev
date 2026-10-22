import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  buildServerBundle,
  verifyBundleManifest,
} from '../scripts/build-server-bundle.mjs';
import { verifyBundleBoundary } from '../scripts/verify-collaboration-bundle.mjs';

const first = await buildServerBundle();
assert.equal(first.reused, true, 'Run after the verified build');
const mtime = (await fs.stat(first.bundle)).mtimeMs;
const second = await buildServerBundle();
assert.equal(second.reused, true);
assert.equal((await fs.stat(first.bundle)).mtimeMs, mtime);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-bundle-cache-'));
const copy = path.join(root, 'server.mjs'),
  meta = copy + '.manifest.json';
const bytes = await fs.readFile(first.bundle),
  manifest = await fs.readFile(first.bundle + '.manifest.json', 'utf8');
try {
  await fs.writeFile(copy, bytes);
  await fs.writeFile(meta, manifest);
  await verifyBundleManifest(copy);
  await fs.appendFile(copy, 'corrupt');
  await assert.rejects(verifyBundleManifest(copy), /checksum/);
  await fs.writeFile(copy, bytes);
  const wrongRuntime = JSON.parse(manifest);
  wrongRuntime.runtime.arch = 'wrong';
  await fs.writeFile(meta, JSON.stringify(wrongRuntime));
  await assert.rejects(verifyBundleManifest(copy), /runtime/);
  const wrongInput = JSON.parse(manifest);
  wrongInput.inputs[0].sha256 = '0'.repeat(64);
  await fs.writeFile(meta, JSON.stringify(wrongInput));
  await assert.rejects(verifyBundleManifest(copy), /input changed/);
  const boundary = JSON.parse(manifest);
  boundary.modules.push('node_modules/electron/index.js');
  await fs.writeFile(meta, JSON.stringify(boundary));
  await assert.rejects(verifyBundleBoundary(copy), /Forbidden/);
  await fs.writeFile(meta, manifest);
  await fs.unlink(copy);
  await assert.rejects(verifyBundleManifest(copy));
  console.log(
    'PASS cache reuse and rejection of missing/corrupt output, changed inputs/runtime and forbidden boundary',
  );
} finally {
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('gamejam-bundle-cache-'));
  await fs.rm(root, { recursive: true, force: true });
}
