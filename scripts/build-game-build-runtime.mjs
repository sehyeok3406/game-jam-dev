import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { rolldown } from 'rolldown';
const root = fileURLToPath(new URL('../', import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function buildGameBuildRuntime() {
  if (process.platform !== 'win32') return;
  const target = path.join(root, 'out/game-build-runtime');
  const npmRoot = path.join(path.dirname(process.execPath), 'node_modules/npm');
  const npm = JSON.parse(
    await fs.readFile(path.join(npmRoot, 'package.json'), 'utf8'),
  );
  if (
    process.versions.node !== '24.19.0' ||
    npm.version !== '11.17.0' ||
    process.arch !== 'x64'
  )
    throw Error(
      '게임 준비 도구는 검증한 Windows x64 Node 24.19.0/npm 11.17.0으로 빌드해주세요.',
    );
  await fs.mkdir(target, { recursive: true });
  const expected = new Set([
    'manifest.json',
    'worker.mjs',
    'builder.mjs',
    'THIRD-PARTY-NOTICES.txt',
  ]);
  const bundledPackages = new Map();
  const copy = async (from, to) => {
    expected.add(path.relative(target, to).split(path.sep).join('/'));
    const source = await fs.readFile(from),
      current = await fs.readFile(to).catch(() => null);
    if (!current || hash(current) !== hash(source)) {
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.writeFile(to, source);
    }
  };
  await copy(process.execPath, path.join(target, 'node.exe'));
  // Independent of the optional collaboration server runtime. Reuse only the pinned license.
  const licensePath = path.join(target, 'NODE-LICENSE.txt');
  const licenseHash =
    '148eacf7863ef4329224a29398623077200a27194aa075569faf4a0a85566ca5';
  let license = await fs.readFile(licensePath).catch(() => null);
  if (!license || hash(license) !== licenseHash) {
    const response = await fetch(
      'https://raw.githubusercontent.com/nodejs/node/v24.19.0/LICENSE',
      { signal: AbortSignal.timeout(30_000), redirect: 'error' },
    );
    if (!response.ok)
      throw Error('Node 재배포 라이선스를 확보하지 못했습니다.');
    license = Buffer.from(await response.arrayBuffer());
    if (hash(license) !== licenseHash)
      throw Error('Node 재배포 라이선스 해시가 일치하지 않습니다.');
    await fs.writeFile(licensePath, license);
  }
  expected.add('NODE-LICENSE.txt');
  async function mirror(from, to) {
    await fs.mkdir(to, { recursive: true });
    for (const entry of await fs.readdir(from, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw Error('도구 묶음의 심볼릭 링크는 지원하지 않습니다.');
      if (entry.isDirectory())
        await mirror(path.join(from, entry.name), path.join(to, entry.name));
      else await copy(path.join(from, entry.name), path.join(to, entry.name));
    }
  }
  await mirror(npmRoot, path.join(target, 'npm'));
  const copied = new Set();
  async function packageCopy(name) {
    if (copied.has(name)) return;
    copied.add(name);
    const source = path.join(root, 'node_modules', name),
      pkg = JSON.parse(
        await fs.readFile(path.join(source, 'package.json'), 'utf8'),
      );
    await mirror(source, path.join(target, 'node_modules', name));
    for (const dep of Object.keys(pkg.dependencies ?? {}))
      await packageCopy(dep);
  }
  await packageCopy('rolldown');
  await packageCopy('@rolldown/binding-win32-x64-msvc');
  for (const [entry, output] of [
    ['worker', 'worker'],
    ['builder', 'builder'],
  ]) {
    const bundle = await rolldown({
      input: path.join(root, `src/adapters/node/game-preparation/${entry}.ts`),
      platform: 'node',
      external: [/^node:/, 'rolldown'],
      onwarn(warning) {
        if (warning.code !== 'CIRCULAR_DEPENDENCY')
          throw Error(warning.message);
      },
    });
    try {
      const result = await bundle.write({
        file: path.join(target, `${output}.mjs`),
        format: 'esm',
      });
      for (const chunk of result.output)
        if (chunk.type === 'chunk')
          for (const id of Object.keys(chunk.modules)) {
            if (
              !id.replaceAll('\\', '/').includes('/node_modules/') ||
              !path.isAbsolute(id)
            )
              continue;
            let directory = path.dirname(id);
            while (
              directory.startsWith(path.join(root, 'node_modules') + path.sep)
            ) {
              const pkg = await fs
                .readFile(path.join(directory, 'package.json'), 'utf8')
                .then(JSON.parse)
                .catch(() => null);
              if (pkg?.name && pkg?.version) {
                bundledPackages.set(`${pkg.name}@${pkg.version}`, {
                  directory,
                  pkg,
                });
                break;
              }
              directory = path.dirname(directory);
            }
          }
    } finally {
      await bundle.close();
    }
  }
  const noticeSections = [];
  for (const [name, { directory, pkg }] of [...bundledPackages].sort(
    ([a], [b]) => a.localeCompare(b, 'en'),
  )) {
    const files = (await fs.readdir(directory))
      .filter((name) =>
        /^(?:licen[sc]e|copying|notice|authors|copyright)(?:[.-].*)?$/i.test(
          name,
        ),
      )
      .sort();
    const texts = [];
    for (const file of files) {
      const target = path.join(directory, file);
      if ((await fs.stat(target)).isFile())
        texts.push(`${file}\n${await fs.readFile(target, 'utf8')}`);
    }
    if (
      !texts.length ||
      !files.some((name) =>
        /^(?:licen[sc]e|copying|notice)(?:[.-].*)?$/i.test(name),
      )
    )
      throw Error(`빌드 도구 재배포 고지 원문이 없습니다: ${name}`);
    noticeSections.push(
      `${name}\nLicense: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license)}\n${texts.join('\n\n')}`,
    );
  }
  await fs.writeFile(
    path.join(target, 'THIRD-PARTY-NOTICES.txt'),
    noticeSections.join('\n\n----------------------------------------\n\n'),
  );
  // Reconcile changed tool inputs without keeping untracked files from an older toolset.
  async function reconcile(directory = target) {
    if (
      !path.resolve(directory).startsWith(path.resolve(target) + path.sep) &&
      path.resolve(directory) !== path.resolve(target)
    )
      throw Error('도구 정리 경로 오류');
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw Error('도구 묶음의 링크는 허용하지 않습니다.');
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await reconcile(absolute);
        if (!(await fs.readdir(absolute)).length) await fs.rmdir(absolute);
      } else if (
        !expected.has(path.relative(target, absolute).split(path.sep).join('/'))
      )
        await fs.unlink(absolute);
    }
  }
  await reconcile();
  const files = [];
  async function scan(relative = '') {
    for (const entry of await fs.readdir(path.join(target, relative), {
      withFileTypes: true,
    })) {
      const name = [relative, entry.name].filter(Boolean).join('/');
      if (entry.isDirectory()) await scan(name);
      else if (name !== 'manifest.json') {
        const bytes = await fs.readFile(path.join(target, name));
        files.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
      }
    }
  }
  await scan();
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const versions = {
    node: process.versions.node,
    npm: npm.version,
    rolldown: JSON.parse(
      await fs.readFile(
        path.join(root, 'node_modules/rolldown/package.json'),
        'utf8',
      ),
    ).version,
    binding: JSON.parse(
      await fs.readFile(
        path.join(
          root,
          'node_modules/@rolldown/binding-win32-x64-msvc/package.json',
        ),
        'utf8',
      ),
    ).version,
  };
  await fs.writeFile(
    path.join(target, 'manifest.json'),
    JSON.stringify(
      {
        version: 1,
        platform: process.platform,
        arch: process.arch,
        versions,
        files,
        sha256: hash(JSON.stringify({ versions, files })),
      },
      null,
      2,
    ),
  );
  return target;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await buildGameBuildRuntime();
