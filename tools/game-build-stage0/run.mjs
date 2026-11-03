import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { rolldown } from 'rolldown';
import electron from 'electron';
import { parse } from 'acorn';
import { fixtures, htmlDocument } from './fixtures.mjs';
import {
  cdp,
  fingerprintTree,
  pause,
  runProcess,
  sha256,
  terminate,
  until,
} from './process.mjs';
import { COOP_REFERENCE_HTML } from '../../src/multiplayer/reference-game.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.join(root, 'out/game-build-stage0');
const workspace = path.join(out, 'workspace');
const npmCli = path.join(
  path.dirname(process.execPath),
  'node_modules/npm/bin/npm-cli.js',
);
const versions = { 'pixi.js': '8.22.0', three: '0.187.0' };
const json = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const writeJson = (file, value) =>
  fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
await fs.mkdir(workspace, { recursive: true });
const evidence = {
  schema: 1,
  startedAt: new Date().toISOString(),
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    rolldown: (
      await json(path.join(root, 'node_modules/rolldown/package.json'))
    ).version,
  },
  versions,
  inputs: [],
  metadata: [],
  cases: [],
  browsers: [],
};
for (const name of [
  'tools/game-build-stage0/run.mjs',
  'tools/game-build-stage0/process.mjs',
  'tools/game-build-stage0/fixtures.mjs',
  'tools/game-build-stage0/electron.mjs',
  'tools/game-build-stage0/runtime.mjs',
  'tools/game-build-stage0/toolset.mjs',
  'tools/game-build-stage0/summarize.mjs',
  'src/html-validation.ts',
  'src/multiplayer/window-manager.ts',
  'src/preview-permissions.ts',
  'src/multiplayer/sdk.ts',
  'src/html-references.ts',
  'package-lock.json',
]) {
  evidence.inputs.push({
    path: name,
    sha256: sha256(await fs.readFile(path.join(root, name))),
  });
}
const packageJson = {
  name: 'gamejam-stage0-only',
  private: true,
  version: '0.0.0',
  dependencies: versions,
};
await writeJson(path.join(workspace, 'package.json'), packageJson);
const npmrc = path.join(out, 'empty-npmrc');
await fs.writeFile(
  npmrc,
  'registry=https://registry.npmjs.org/\nignore-scripts=true\naudit=false\nfund=false\n',
);
const globalNpmrc = path.join(out, 'empty-global-npmrc');
await fs.writeFile(globalNpmrc, '');
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^npm_config_|^npm_token$|^node_auth_token$|^node_options$/i.test(key),
  ),
);
const npmOptions = [
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
  '--userconfig',
  npmrc,
  '--globalconfig',
  globalNpmrc,
  '--cache',
  path.join(out, 'npm-cache'),
];

for (const [name, version] of Object.entries(versions)) {
  const response = await fetch(`https://registry.npmjs.org/${name}/${version}`);
  assert(response.ok, `Registry lookup failed: ${name}`);
  const metadata = await response.json();
  const [algorithm, expected] = metadata.dist.integrity.split('-');
  const archivePath = path.join(
    out,
    `${name.replaceAll('/', '_')}-${version}.tgz`,
  );
  let archive;
  try {
    archive = await fs.readFile(archivePath);
  } catch {
    archive = Buffer.from(
      await (await fetch(metadata.dist.tarball)).arrayBuffer(),
    );
    await fs.writeFile(archivePath, archive);
  }
  assert.equal(
    createHash(algorithm).update(archive).digest('base64'),
    expected,
    `Integrity mismatch: ${name}`,
  );
  evidence.metadata.push({
    name,
    version,
    license: metadata.license,
    tarball: metadata.dist.tarball,
    integrity: metadata.dist.integrity,
    compressedBytes: archive.length,
    unpackedBytes: metadata.dist.unpackedSize,
  });
}

let reusable = false;
try {
  const previous = await json(path.join(out, 'dependency-fingerprint.json'));
  reusable =
    previous.node === process.version &&
    previous.platform === process.platform &&
    previous.arch === process.arch &&
    JSON.stringify(previous.versions) === JSON.stringify(versions) &&
    previous.lockHash ===
      sha256(await fs.readFile(path.join(workspace, 'package-lock.json'))) &&
    previous.treeHash ===
      sha256(
        JSON.stringify(
          await fingerprintTree(path.join(workspace, 'node_modules')),
        ),
      );
} catch {
  /* No verified cache yet. */
}
if (!reusable) {
  console.log(
    'stage0: install exact test dependencies in out/game-build-stage0/workspace',
  );
  const result = await runProcess(
    process.execPath,
    [npmCli, 'install', ...npmOptions],
    { cwd: workspace, env, timeout: 180000 },
  );
  await fs.writeFile(
    path.join(out, 'npm-install.log'),
    result.stdout + result.stderr,
  );
}
const tree = await fingerprintTree(path.join(workspace, 'node_modules'));
const dependencyFingerprint = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  versions,
  lockHash: sha256(
    await fs.readFile(path.join(workspace, 'package-lock.json')),
  ),
  treeHash: sha256(JSON.stringify(tree)),
  files: tree.length,
  bytes: tree.reduce((n, item) => n + item.bytes, 0),
};
await writeJson(
  path.join(out, 'dependency-fingerprint.json'),
  dependencyFingerprint,
);
evidence.dependencies = { ...dependencyFingerprint, cacheReused: reusable };
const lock = await json(path.join(workspace, 'package-lock.json'));
evidence.lockedPackages = Object.entries(lock.packages)
  .filter(([name]) => name)
  .map(([name, value]) => ({
    path: name,
    version: value.version,
    resolved: value.resolved,
    integrity: value.integrity,
    hasInstallScript: !!value.hasInstallScript,
  }));
const notices = [];
for (const [name, value] of Object.entries(lock.packages).filter(
  ([name]) => name,
)) {
  const directory = path.join(workspace, name);
  const license = (await fs.readdir(directory)).find((name) =>
    /^licen[sc]e(?:\.(?:md|txt))?$/i.test(name),
  );
  notices.push({
    name: name.replace(/^node_modules\//, ''),
    version: value.version,
    license: value.license,
    notice: license
      ? await fs.readFile(path.join(directory, license), 'utf8')
      : null,
  });
}
evidence.licenseNotices = notices.map(({ notice, ...record }) => ({
  ...record,
  noticeBytes: notice ? Buffer.byteLength(notice) : 0,
}));
await writeJson(path.join(out, 'third-party-notices.json'), notices);

// A synthetic PNG makes this a decoding/rendering check, not an art dependency.
function syntheticPng() {
  const crc = (bytes) => {
    let value = 0xffffffff;
    for (const byte of bytes) {
      value ^= byte;
      for (let n = 0; n < 8; n++)
        value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (name, bytes) => {
    const tag = Buffer.from(name),
      length = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    checksum.writeUInt32BE(crc(Buffer.concat([tag, bytes])));
    return Buffer.concat([length, tag, bytes, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(64);
  header.writeUInt32BE(64, 4);
  header[8] = 8;
  header[9] = 6;
  const scan = Buffer.alloc(64 * (1 + 64 * 4));
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const index = y * 257 + 1 + x * 4,
        warm = ((x >> 3) + (y >> 3)) % 2 === 0;
      scan.set(warm ? [240, 158, 60, 255] : [47, 136, 98, 255], index);
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scan)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const imageBytes = syntheticPng();
await fs.writeFile(path.join(out, 'selected-image.png'), imageBytes);
const assetUri = `data:image/png;base64,${imageBytes.toString('base64')}`;
evidence.asset = {
  path: 'synthetic-selected-image.png',
  bytes: imageBytes.length,
  sha256: sha256(imageBytes),
};
const exported = await fs.mkdtemp(
  path.join(os.tmpdir(), 'gamejam-stage0-export-'),
);
evidence.externalExportDirectory = exported;
const cases = fixtures(assetUri);
const defaultPixi = cases.find((item) => item.id === 'pixi-image');
cases.push({
  ...defaultPixi,
  id: 'pixi-default-csp',
  supported: false,
  limitation:
    'Default code generation requires a CSP-compatible library entry point',
  source: defaultPixi.source.replace("import 'pixi.js/unsafe-eval';", ''),
});
const largeImage = await fs.readFile(path.join(root, 'assets/icon.png'));
evidence.largeAsset = {
  path: 'assets/icon.png',
  bytes: largeImage.length,
  sha256: sha256(largeImage),
};
cases.push({
  ...cases[0],
  id: 'large-image',
  supported: false,
  limitation: 'Production data URL navigation size limit',
  source: cases[0].source.replace(
    JSON.stringify(assetUri),
    JSON.stringify(`data:image/png;base64,${largeImage.toString('base64')}`),
  ),
});
for (const item of cases) {
  const directory = path.join(workspace, item.id);
  await fs.mkdir(directory, { recursive: true });
  const entry = path.join(directory, 'main.js');
  await fs.writeFile(entry, item.source);
  for (const [name, source] of Object.entries(item.extraFiles ?? {}))
    await fs.writeFile(path.join(directory, name), source);
  const started = performance.now();
  const before = process.memoryUsage();
  const build = await rolldown({
    input: entry,
    platform: 'browser',
    onwarn(warning) {
      if (warning.code === 'UNRESOLVED_IMPORT') throw Error(warning.message);
    },
  });
  let output;
  try {
    output = await build.generate({
      format: 'iife',
      codeSplitting: false,
      minify: true,
      comments: { legal: true },
      sourcemap: false,
    });
  } finally {
    await build.close();
  }
  assert.equal(
    output.output.length,
    1,
    `${item.id}: expected one emitted chunk`,
  );
  const chunk = output.output[0];
  assert.equal(chunk.type, 'chunk');
  const runtimeImports = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (
      [
        'ImportDeclaration',
        'ImportExpression',
        'ExportAllDeclaration',
        'ExportNamedDeclaration',
      ].includes(node.type)
    )
      runtimeImports.push(node.type);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(parse(chunk.code, { ecmaVersion: 'latest', sourceType: 'script' }));
  // Rolldown can retain a self-edge in dynamicImports after inlining. Check
  // executable syntax as well as the emitted file count instead of that graph.
  assert.equal(
    runtimeImports.length,
    0,
    `${item.id}: unresolved executable imports`,
  );
  const html = htmlDocument(item.id, chunk.code, item.multiplayer).replace(
    '</body>',
    `<script type="application/json" id="stage0-third-party-notices">${JSON.stringify(notices).replaceAll('<', '\\u003c')}</script></body>`,
  );
  const file = path.join(exported, item.id + '.html');
  await fs.writeFile(file, html);
  // Also keep an export artifact; browsers only open the external copy above.
  await fs.copyFile(file, path.join(out, item.id + '.html'));
  const after = process.memoryUsage();
  evidence.cases.push({
    id: item.id,
    supported: item.supported,
    limitation: item.limitation,
    file,
    requiresAppSdk: !!item.multiplayer,
    sha256: sha256(html),
    htmlBytes: Buffer.byteLength(html),
    jsBytes: Buffer.byteLength(chunk.code),
    jsSha256: sha256(chunk.code),
    buildMs: Math.round(performance.now() - started),
    heapDeltaBytes: after.heapUsed - before.heapUsed,
    rssBytes: after.rss,
    modules: Object.keys(chunk.modules).length,
    sourceSha256: sha256(item.source),
    runtimeImports,
    chunkDynamicImports: chunk.dynamicImports,
    inputAssetBytes: item.source.includes('ASSET_URI')
      ? item.id === 'large-image'
        ? largeImage.length
        : imageBytes.length
      : 0,
  });
  console.log(`stage0 bundle: ${item.id}, ${Buffer.byteLength(html)} bytes`);
}
const legacyFile = path.join(exported, 'legacy-reference.html');
await fs.writeFile(legacyFile, COOP_REFERENCE_HTML);
await fs.copyFile(legacyFile, path.join(out, 'legacy-reference.html'));
evidence.cases.push({
  id: 'legacy-reference',
  supported: true,
  requiresAppSdk: true,
  file: legacyFile,
  sha256: sha256(COOP_REFERENCE_HTML),
  htmlBytes: Buffer.byteLength(COOP_REFERENCE_HTML),
  jsBytes: null,
  buildMs: 0,
});

console.log('stage0: offline lock replay and packaged Node/native bundler');
const replay = path.join(
  out,
  'offline-replay',
  dependencyFingerprint.lockHash.slice(0, 12),
);
await fs.mkdir(path.join(replay, 'workspace'), { recursive: true });
for (const name of ['package.json', 'package-lock.json'])
  await fs.copyFile(
    path.join(workspace, name),
    path.join(replay, 'workspace', name),
  );
const replayResult = await runProcess(
  process.execPath,
  [npmCli, 'ci', '--offline', ...npmOptions],
  { cwd: path.join(replay, 'workspace'), env, timeout: 120000 },
);
await fs.writeFile(
  path.join(out, 'npm-offline-replay.log'),
  replayResult.stdout + replayResult.stderr,
);
const replayTree = await fingerprintTree(
  path.join(replay, 'workspace/node_modules'),
);
evidence.offlineReplay = {
  treeHash: sha256(JSON.stringify(replayTree)),
  sameTree:
    sha256(JSON.stringify(replayTree)) === dependencyFingerprint.treeHash,
  network: 'npm --offline',
};
assert(
  evidence.offlineReplay.sameTree,
  'Offline replay changed dependency files',
);
for (const id of ['pixi-image', 'three-image']) {
  await fs.mkdir(path.join(replay, 'workspace', id), { recursive: true });
  await fs.copyFile(
    path.join(workspace, id, 'main.js'),
    path.join(replay, 'workspace', id, 'main.js'),
  );
}
const packagedNode = path.join(
  root,
  'out/Game Jam!-win32-x64/resources/self-host-runtime/node.exe',
);
await fs.access(packagedNode);
await runProcess(
  packagedNode,
  [path.join(root, 'tools/game-build-stage0/runtime.mjs'), replay],
  { cwd: root, env, timeout: 60000 },
);
evidence.packagedRuntime = {
  executable: packagedNode,
  sha256: sha256(await fs.readFile(packagedNode)),
  ...(await json(path.join(replay, 'packaged-runtime-result.json'))),
};
for (const built of evidence.packagedRuntime.builds) {
  built.sameJs =
    built.sha256 ===
    evidence.cases.find((item) => item.id === built.id).jsSha256;
  assert(built.sameJs, `${built.id}: packaged runtime rebuild differed`);
}
await runProcess(
  process.execPath,
  [path.join(root, 'tools/game-build-stage0/toolset.mjs')],
  { cwd: root, env, timeout: 120000 },
);
evidence.portableToolset = await json(path.join(out, 'portable-toolset.json'));
for (const built of evidence.portableToolset.builds) {
  built.sameJs =
    built.sha256 ===
    evidence.cases.find((item) => item.id === built.id).jsSha256;
  assert(built.sameJs, `${built.id}: portable runtime rebuild differed`);
}

const manager = await fs.readFile(
  path.join(root, 'src/multiplayer/window-manager.ts'),
  'utf8',
);
const playerCsp = manager.match(/const csp =\s*\n?\s*"([^"]+)";/)?.[1];
assert(playerCsp, 'Could not extract production player CSP');
const inputFile = path.join(out, 'input.json');
const electronResult = path.join(out, 'electron-results.json');
await writeJson(inputFile, {
  cases: evidence.cases,
  playerCsp,
  electronResult,
});
const electronBuild = await rolldown({
  input: path.join(root, 'tools/game-build-stage0/electron.mjs'),
  platform: 'node',
  external: ['electron'],
});
try {
  await electronBuild.write({
    file: path.join(out, 'electron-main.cjs'),
    format: 'cjs',
    codeSplitting: false,
  });
} finally {
  await electronBuild.close();
}
console.log('stage0: production validators and Electron policy harness');
const electronRun = await runProcess(
  electron,
  [path.join(out, 'electron-main.cjs')],
  {
    cwd: root,
    timeout: 180000,
    env: {
      ...env,
      GAMEJAM_STAGE0_PROFILE: path.join(out, 'profiles', randomUUID()),
      GAMEJAM_STAGE0_INPUT: inputFile,
    },
  },
);
await fs.writeFile(
  path.join(out, 'electron.log'),
  electronRun.stdout + electronRun.stderr,
);
evidence.electron = await json(electronResult);

for (const [name, executable] of [
  ['chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe'],
  ['edge', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'],
]) {
  await fs.access(executable);
  const profile = path.join(out, 'profiles', `${name}-${randomUUID()}`);
  await fs.mkdir(profile, { recursive: true });
  const child = spawn(
    executable,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let log = '';
  child.stderr.on('data', (chunk) => (log = (log + chunk).slice(-200000)));
  let client;
  try {
    const port = await until(async () => {
      try {
        return Number(
          (
            await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')
          ).split('\n')[0],
        );
      } catch {
        return null;
      }
    }, `${name} debugging port`);
    const target = (
      await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    ).find((item) => item.type === 'page');
    assert(target, `${name}: no page`);
    client = await cdp(target.webSocketDebuggerUrl);
    await client.send('Network.enable');
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    await client.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
    const requests = [];
    client.on('Network.requestWillBeSent', ({ request }) => {
      if (/^https?:/i.test(request.url)) requests.push(request.url);
    });
    const result = {
      name,
      executable,
      version: await client.send('Browser.getVersion'),
      offline: true,
      outcomes: [],
    };
    for (const item of evidence.cases) {
      if (item.requiresAppSdk) {
        result.outcomes.push({
          id: item.id,
          skipped: true,
          reason:
            'Existing app SDK contract; not an externally runnable online artifact',
        });
        continue;
      }
      const startRequests = requests.length;
      await client.send('Page.navigate', {
        url: pathToFileURL(item.file).href,
      });
      let observed;
      for (let n = 0; n < 100; n++) {
        try {
          observed = await client.js('window.__stage0');
        } catch {
          /* Navigation in progress. */
        }
        if (observed?.ready || observed?.errors?.length) break;
        await pause(100);
      }
      if (
        observed?.ready &&
        ['canvas-image', 'pixi-image', 'three-image'].includes(item.id)
      ) {
        await client.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'ArrowRight',
          code: 'ArrowRight',
          windowsVirtualKeyCode: 39,
        });
        await client.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'ArrowRight',
          code: 'ArrowRight',
          windowsVirtualKeyCode: 39,
        });
        observed = await client.js('window.__stage0');
        const screenshot = await client.send('Page.captureScreenshot', {
          format: 'png',
        });
        await fs.writeFile(
          path.join(out, `${name}-${item.id}.png`),
          Buffer.from(screenshot.data, 'base64'),
        );
      }
      const httpRequests = requests.slice(startRequests);
      const interactive = [
        'canvas-image',
        'pixi-image',
        'three-image',
      ].includes(item.id);
      result.outcomes.push({
        id: item.id,
        ok:
          !!observed?.ready &&
          observed.render?.nonBlank !== false &&
          (!interactive || observed.moves === 1) &&
          !observed.errors.length &&
          !httpRequests.length,
        observed,
        httpRequests,
      });
      console.log(`stage0 ${name}: ${item.id}, ready=${!!observed?.ready}`);
    }
    evidence.browsers.push(result);
  } finally {
    client?.close();
    await terminate(child);
    await fs.writeFile(path.join(out, `${name}.log`), log);
  }
}
evidence.finishedAt = new Date().toISOString();
evidence.expectedSupportedFailures = evidence.electron.outcomes.filter(
  (item) =>
    evidence.cases.find((candidate) => candidate.id === item.id)?.supported &&
    !item.ok,
);
for (const browser of evidence.browsers)
  for (const item of browser.outcomes) {
    if (
      !item.skipped &&
      evidence.cases.find((candidate) => candidate.id === item.id)?.supported &&
      !item.ok
    )
      evidence.expectedSupportedFailures.push({
        ...item,
        browser: browser.name,
      });
  }
await writeJson(path.join(out, 'verification.json'), evidence);
console.log(
  JSON.stringify({
    report: path.join(out, 'verification.json'),
    expectedSupportedFailures: evidence.expectedSupportedFailures.length,
  }),
);
if (evidence.expectedSupportedFailures.length) process.exitCode = 1;
