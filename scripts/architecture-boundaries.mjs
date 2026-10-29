import fs from 'node:fs';
import path from 'node:path';
import { isBuiltin } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const slash = (value) => value.replaceAll('\\', '/');
const inside = (file, directory) => file.startsWith(`${directory}/`);
const sourceFile = /\.(?:[cm]?[jt]sx?)$/;
const selfHostUiModules = new Set([
  'src/features/self-host/types.ts',
  'src/features/self-host/help.ts',
  'src/features/self-host/enabled.ts',
]);
const selfHostBackend = (file) =>
  inside(file, 'src/features/self-host') &&
  !file.endsWith('.tsx') &&
  !selfHostUiModules.has(file);

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? filesIn(file)
      : sourceFile.test(file)
        ? [file]
        : [];
  });
}

export function inspectSource(file, source, resolve) {
  const findings = [];
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const contracts = inside(file, 'src/contracts');
  const core = inside(file, 'src/core');
  const application = inside(file, 'src/application');
  // self-host also contains Electron services, not just UI. Its TSX screens
  // still obey the UI rules; its backend modules are checked when imported.
  const ui =
    inside(file, 'src/ui') ||
    (inside(file, 'src/features') && !selfHostBackend(file));
  const add = (rule, target, node) =>
    findings.push({
      rule,
      file,
      target,
      line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
    });

  function dependency(node, expression) {
    if (!expression || !ts.isStringLiteralLike(expression)) {
      if (contracts || core || application || ui)
        add('dynamic-module', '<computed>', node);
      return;
    }
    const specifier = expression.text;
    const target = resolve(specifier, file) ?? specifier;
    const platform =
      isBuiltin(specifier) ||
      specifier === 'electron' ||
      specifier.startsWith('electron/');
    if (contracts && !inside(target, 'src/contracts'))
      add('contracts-dependency', target, node);
    if (
      core &&
      !['src/core', 'src/contracts'].some((dir) => inside(target, dir))
    )
      add('core-dependency', target, node);
    if (
      application &&
      !['src/application', 'src/core', 'src/contracts'].some((dir) =>
        inside(target, dir),
      )
    )
      add('application-dependency', target, node);
    if (
      ui &&
      (platform ||
        ['src/application', 'src/adapters', 'src/desktop', 'src/server'].some(
          (dir) => inside(target, dir),
        ) ||
        selfHostBackend(target) ||
        /^src\/(?:main|preload|renderer|collaboration-server(?:-entry)?)\.[cm]?[jt]sx?$/.test(
          target,
        ))
    )
      add('ui-platform-dependency', target, node);
    if (target === 'src/shared.ts') add('compatibility-import', target, node);
  }

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    )
      dependency(node, node.moduleSpecifier);
    if (ts.isImportTypeNode(node)) dependency(node, node.argument.literal);
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    )
      dependency(node, node.moduleReference.expression);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    )
      dependency(node, node.arguments[0]);

    // Examine syntax, not comments or strings. This also catches optional
    // chaining, bracket access and destructuring from window/globalThis.
    if (ui) {
      if (
        (ts.isPropertyAccessExpression(node) ||
          ts.isElementAccessExpression(node)) &&
        ts.isIdentifier(node.expression) &&
        ['window', 'globalThis'].includes(node.expression.text)
      ) {
        const name = ts.isPropertyAccessExpression(node)
          ? node.name.text
          : ts.isStringLiteralLike(node.argumentExpression)
            ? node.argumentExpression.text
            : null;
        if (name === 'gameCanvas' || name === 'localStorage')
          add('ui-global-access', name, node);
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isObjectBindingPattern(node.name) &&
        node.initializer &&
        ts.isIdentifier(node.initializer) &&
        ['window', 'globalThis'].includes(node.initializer.text)
      ) {
        for (const element of node.name.elements) {
          const name = element.propertyName ?? element.name;
          if (
            (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) &&
            ['gameCanvas', 'localStorage'].includes(name.text)
          )
            add('ui-global-access', name.text, element);
        }
      }
      if (
        ts.isIdentifier(node) &&
        node.text === 'localStorage' &&
        !(
          ts.isPropertyAccessExpression(node.parent) &&
          node.parent.name === node
        ) &&
        !ts.isBindingElement(node.parent)
      )
        add('ui-global-access', 'localStorage', node);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return findings;
}

export function scanArchitecture(root) {
  const configPath = path.join(root, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error)
    throw Error(
      ts.flattenDiagnosticMessageText(config.error.messageText, '\n'),
    );
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  if (parsed.errors.length)
    throw Error(
      parsed.errors
        .map((error) =>
          ts.flattenDiagnosticMessageText(error.messageText, '\n'),
        )
        .join('\n'),
    );
  const cache = ts.createModuleResolutionCache(
    root,
    (name) => name,
    parsed.options,
  );
  const resolve = (specifier, from) => {
    const resolved = ts.resolveModuleName(
      specifier,
      path.join(root, from),
      parsed.options,
      ts.sys,
      cache,
    ).resolvedModule?.resolvedFileName;
    // External packages retain their specifier. Local aliases resolve to the
    // same canonical target as relative paths and cannot bypass layer rules.
    return resolved && !slash(resolved).includes('/node_modules/')
      ? slash(path.relative(root, resolved))
      : undefined;
  };
  return filesIn(path.join(root, 'src'))
    .sort()
    .flatMap((filename) =>
      inspectSource(
        slash(path.relative(root, filename)),
        fs.readFileSync(filename, 'utf8'),
        resolve,
      ),
    );
}

export const findingKey = ({ rule, file, target }) =>
  `${rule}|${file}|${target}`;

export function compareBaseline(findings, baseline) {
  const actual = new Map();
  for (const finding of findings) {
    const key = findingKey(finding);
    actual.set(key, (actual.get(key) ?? 0) + 1);
  }
  const errors = [];
  const allowed = new Map();
  for (const group of baseline.groups) {
    if (!group.reason?.trim() || !group.removeWhen?.trim())
      errors.push(
        'Every exception group needs a reason and removal condition.',
      );
    for (const [key, count] of Object.entries(group.entries)) {
      if (allowed.has(key) || !Number.isInteger(count) || count < 1)
        errors.push(`Invalid or duplicate exception: ${key}`);
      allowed.set(key, count);
    }
  }
  for (const [key, count] of actual) {
    const limit = allowed.get(key) ?? 0;
    if (count > limit) {
      const finding = findings.find((item) => findingKey(item) === key);
      errors.push(
        `${finding.file}:${finding.line} ${finding.rule} → ${finding.target} (${count}, allowed ${limit})`,
      );
    }
  }
  for (const [key, count] of allowed) {
    if ((actual.get(key) ?? 0) < count)
      errors.push(
        `Remove or reduce resolved exception: ${key} (${actual.get(key) ?? 0}, recorded ${count})`,
      );
  }
  return errors;
}

export function verifyArchitecture(root) {
  const baseline = JSON.parse(
    fs.readFileSync(
      path.join(root, 'docs/architecture/boundary-exceptions.json'),
      'utf8',
    ),
  );
  return compareBaseline(scanArchitecture(root), baseline);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const errors = verifyArchitecture(root);
  if (errors.length) {
    console.error(errors.join('\n'));
    console.error(
      'See docs/architecture/README.md. Fix the dependency; do not regenerate the exception baseline to make checks pass.',
    );
    process.exitCode = 1;
  } else
    console.log(
      'Architecture boundaries passed (including existing exception counts).',
    );
}
