import fs from 'node:fs/promises';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { parse } from 'acorn';
import { fileURLToPath } from 'node:url';
import { verifyBundleManifest } from './build-server-bundle.mjs';
import { verifyServerBundle } from '../tests/server-bundle-smoke.mjs';

export async function verifyBundleBoundary(bundle) {
  const manifest = await verifyBundleManifest(bundle);
  const forbidden =
    /(?:^|\/)(?:electron(?:-squirrel-startup)?|discord\.js|keytar)(?:\/|$)|^src\/(?:main\.ts|preload\.ts|renderer\.tsx|desktop\/|ui\/|ai-cli\.ts|ai-providers\.ts|project-library\.ts|discord-approval\.ts)/;
  for (const module of manifest.modules)
    if (forbidden.test(module))
      throw Error('Forbidden server module: ' + module);
  const code = await fs.readFile(bundle, 'utf8');
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  const builtins = new Set([
    ...builtinModules,
    ...builtinModules.map((name) => 'node:' + name),
  ]);
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    let source;
    if (
      node.type === 'ImportDeclaration' ||
      node.type === 'ExportAllDeclaration' ||
      node.type === 'ExportNamedDeclaration'
    )
      source = node.source;
    if (node.type === 'ImportExpression') source = node.source;
    if (
      node.type === 'CallExpression' &&
      node.callee?.type === 'Identifier' &&
      node.callee.name === 'require'
    )
      source = node.arguments[0];
    if (source && (source.type !== 'Literal' || !builtins.has(source.value)))
      throw Error('Non-builtin runtime dependency in server bundle');
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast);
  return manifest;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const index = process.argv.indexOf('--bundle');
  const bundle = path.resolve(
    index < 0 ? 'out/collaboration-server/server.mjs' : process.argv[index + 1],
  );
  const manifest = await verifyBundleBoundary(bundle);
  const fixtureIndex = process.argv.indexOf('--windows-fixture');
  const result = await verifyServerBundle({
    bundle,
    load: process.argv.includes('--load'),
    windowsFixture:
      fixtureIndex < 0
        ? undefined
        : path.resolve(process.argv[fixtureIndex + 1]),
  });
  await fs.writeFile(
    bundle + '.verification.json',
    JSON.stringify(
      { ...result, sha256: manifest.sha256, fingerprint: manifest.fingerprint },
      null,
      2,
    ),
  );
  console.log('PASS server bundle boundary/runtime · ' + manifest.sha256);
}
