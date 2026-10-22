import { build, version as viteVersion } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const sha256 = (bytes) =>
  createHash('sha256').update(bytes).digest('hex');
const options = {
  target: 'node24',
  format: 'es',
  noExternal: true,
  viteVersion,
};
const fixedInputs = [
  'package.json',
  'package-lock.json',
  '.node-version',
  'scripts/build-server-bundle.mjs',
  'scripts/build-collaboration-server.mjs',
  'scripts/build-self-host-runtime.mjs',
];
const identity = () => ({
  node: process.versions.node,
  platform: process.platform,
  arch: process.arch,
  options,
});
export async function verifyBundleManifest(bundle) {
  const manifest = JSON.parse(
    await fs.readFile(bundle + '.manifest.json', 'utf8'),
  );
  if (
    manifest.schema !== 1 ||
    JSON.stringify(manifest.runtime) !== JSON.stringify(identity())
  )
    throw Error('Bundle runtime/options mismatch');
  if (
    !fixedInputs.every((name) =>
      manifest.inputs.some((input) => input.path === name),
    )
  )
    throw Error('Missing bundle inputs');
  for (const input of manifest.inputs) {
    const full = path.resolve(root, input.path);
    if (
      path.relative(root, full).startsWith('..') ||
      path.isAbsolute(path.relative(root, full))
    )
      throw Error('Invalid manifest input');
    if (sha256(await fs.readFile(full)) !== input.sha256)
      throw Error('Bundle input changed: ' + input.path);
  }
  const bytes = await fs.readFile(bundle);
  if (bytes.length !== manifest.size || sha256(bytes) !== manifest.sha256)
    throw Error('Bundle output checksum mismatch');
  const fingerprint = sha256(
    JSON.stringify({ runtime: manifest.runtime, inputs: manifest.inputs }),
  );
  if (fingerprint !== manifest.fingerprint)
    throw Error('Bundle fingerprint mismatch');
  if (!Array.isArray(manifest.modules) || !manifest.modules.length)
    throw Error('Missing module boundary proof');
  return manifest;
}
let building;
export function buildServerBundle() {
  return (building ??= buildOnce().finally(() => {
    building = undefined;
  }));
}
async function buildOnce() {
  if (
    process.versions.node !==
    (await fs.readFile(path.join(root, '.node-version'), 'utf8')).trim()
  )
    throw Error('Use the exact Node version pinned in .node-version');
  const directory = path.join(root, 'out/collaboration-server');
  const bundle = path.join(directory, 'server.mjs');
  try {
    const manifest = await verifyBundleManifest(bundle);
    return { bundle, manifest, reused: true };
  } catch {
    /* Missing, changed or damaged artifacts must be built again. */
  }
  await fs.mkdir(path.join(root, 'out'), { recursive: true });
  const staging = await fs.mkdtemp(path.join(root, 'out/server-build-'));
  const modules = new Set(),
    inputs = new Set(fixedInputs);
  const before = new Map(
    await Promise.all(
      fixedInputs.map(async (name) => [
        name,
        sha256(await fs.readFile(path.join(root, name))),
      ]),
    ),
  );
  try {
    await build({
      root,
      configFile: false,
      logLevel: 'warn',
      ssr: { noExternal: true },
      plugins: [
        {
          name: 'server-input-manifest',
          enforce: 'pre',
          async load(id) {
            if (id.startsWith('\0') || !path.isAbsolute(id)) return null;
            const filename = id.split('?')[0];
            const bytes = await fs.readFile(filename).catch(() => null);
            if (bytes)
              before.set(
                path.relative(root, filename).split(path.sep).join('/'),
                sha256(bytes),
              );
            return null;
          },
          generateBundle() {
            for (const id of this.getModuleIds()) {
              if (id.startsWith('\0') || !path.isAbsolute(id)) continue;
              const filename = id.split('?')[0];
              modules.add(
                path.relative(root, filename).split(path.sep).join('/'),
              );
              inputs.add(
                path.relative(root, filename).split(path.sep).join('/'),
              );
            }
          },
        },
      ],
      build: {
        ssr: path.join(root, 'src/collaboration-server-entry.ts'),
        target: options.target,
        outDir: staging,
        emptyOutDir: false,
        rollupOptions: {
          output: {
            format: 'es',
            entryFileNames: 'server.mjs',
            codeSplitting: false,
          },
        },
      },
    });
    // Package metadata can alter Node/Vite resolution without changing JS bytes.
    for (const filename of inputs) {
      let parent = path.dirname(path.resolve(root, filename));
      while (parent.startsWith(root) && parent !== root) {
        const meta = path.join(parent, 'package.json');
        if (await fs.stat(meta).catch(() => null))
          inputs.add(path.relative(root, meta).split(path.sep).join('/'));
        parent = path.dirname(parent);
      }
    }
    const hashes = await Promise.all(
      [...inputs].sort().map(async (filename) => ({
        path: filename,
        sha256: sha256(await fs.readFile(path.resolve(root, filename))),
      })),
    );
    for (const input of hashes)
      if (before.has(input.path) && before.get(input.path) !== input.sha256)
        throw Error('Build input changed during compilation: ' + input.path);
    const bytes = await fs.readFile(path.join(staging, 'server.mjs'));
    const runtime = identity();
    const manifest = {
      schema: 1,
      runtime,
      inputs: hashes,
      modules: [...modules].sort(),
      fingerprint: sha256(JSON.stringify({ runtime, inputs: hashes })),
      sha256: sha256(bytes),
      size: bytes.length,
    };
    await fs.mkdir(directory, { recursive: true });
    await fs.copyFile(path.join(staging, 'server.mjs'), bundle);
    await fs.writeFile(
      bundle + '.manifest.json',
      JSON.stringify(manifest, null, 2),
    );
    return { bundle, manifest, reused: false };
  } finally {
    await removeStaging(staging);
  }
}
async function removeStaging(staging) {
  if (
    path.dirname(staging) !== path.join(root, 'out') ||
    !path.basename(staging).startsWith('server-build-')
  )
    throw Error('Unsafe build cleanup');
  await fs.rm(staging, { recursive: true, force: true });
}
