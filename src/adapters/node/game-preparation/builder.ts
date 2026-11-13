import fs from 'node:fs/promises';
import path from 'node:path';
import { rolldown } from 'rolldown';
import {
  parse,
  parseFragment,
  serialize,
  type DefaultTreeAdapterMap,
} from 'parse5';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import { parse as parseJavaScript } from 'acorn';
import type { GeneratedGameSource } from '../../../contracts/game-build-execution.ts';
import type {
  GameBuildDependenciesV1,
  GameBuildNoticesV1,
} from '../../../contracts/game-build.ts';
import { GameBuildLimits } from '../../../contracts/game-build.ts';
import { validateGameBuildSource } from '../../../core/ai/game-build-source.ts';
import { validateDependencyLock } from '../../../core/ai/dependency-preparation.ts';

type Input = {
  local?: boolean;
  source: GeneratedGameSource;
  assets: Record<string, string>;
  dependencyRoot: string | null;
  lock: GameBuildDependenciesV1;
  notices: GameBuildNoticesV1;
  toolsetSha256: string;
};
type Node = DefaultTreeAdapterMap['node'];
const profile = 'standalone-browser-v1';
const csp =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const json = (value: unknown) =>
  JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
function fail(message: string): never {
  throw Error(message);
}
async function main(input: Input) {
  const { plan, sources } = input.source;
  validateGameBuildSource(
    plan,
    sources,
    Object.fromEntries(plan.assets.map((a) => [a.path, 'provided'])),
    Buffer.byteLength,
  );
  validateDependencyLock(input.lock);
  const sourceRoot = path.join(process.cwd(), 'source');
  await fs.mkdir(sourceRoot);
  for (const [relative, text] of Object.entries(sources)) {
    await fs.mkdir(path.dirname(path.join(sourceRoot, relative)), {
      recursive: true,
    });
    await fs.writeFile(path.join(sourceRoot, relative), text);
  }
  const dependencyRoot = input.dependencyRoot
    ? await fs.realpath(input.dependencyRoot)
    : null;
  const inside = (file: string, root: string) =>
    file.startsWith(root + path.sep);
  const owner = (file: string) =>
    dependencyRoot
      ? input.lock.packages
          .filter((p) => inside(file, path.join(dependencyRoot, p.key)))
          .sort((a, b) => b.key.length - a.key.length)[0]
      : undefined;
  const asset = (value: string) => {
    const key = value.slice('gamejam:asset/'.length);
    return input.assets[key] ?? fail(`선언하지 않은 이미지: ${key}`);
  };
  function resource(value: string) {
    if (value.startsWith('gamejam:asset/')) return asset(value);
    if (
      /^data:(?:image\/(?:png|jpeg|webp|gif)|font\/[a-z0-9.+-]+|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+);base64,[a-z0-9+/=\s]*$/i.test(
        value,
      ) ||
      value.startsWith('#')
    )
      return value;
    fail(`독립 HTML에 포함되지 않은 리소스: ${value.slice(0, 150)}`);
  }
  function css(text: string) {
    const tree = postcss.parse(text);
    tree.walkDecls((d) => {
      const parsed = valueParser(d.value);
      parsed.walk((n) => {
        if (n.type === 'function' && n.value.toLowerCase() === 'url') {
          const value = valueParser
            .stringify(n.nodes)
            .trim()
            .replace(/^(['"])(.*)\1$/s, '$2');
          if (value.startsWith('gamejam:asset/')) {
            asset(value);
            n.value = 'var';
            n.nodes = [
              {
                type: 'word',
                value: '--gamejam-asset-' + value.slice(14),
                sourceIndex: 0,
                sourceEndIndex: 0,
              },
            ];
            return;
          }
          n.nodes = [
            {
              type: 'string',
              quote: '"',
              value: resource(value),
              sourceIndex: 0,
              sourceEndIndex: 0,
            },
          ];
        }
      });
      d.value = parsed.toString();
    });
    tree.walkAtRules('import', () =>
      fail('CSS @import 대신 소스 entry에서 CSS 파일을 import해주세요.'),
    );
    return tree.toString();
  }
  const bundle = await rolldown({
    input: path.join(sourceRoot, plan.entry),
    platform: 'browser',
    resolve: { conditionNames: ['browser', 'import', 'default'] },
    plugins: [
      {
        name: 'gamejam-declared-files',
        async resolveId(specifier, importer) {
          if (specifier === 'gamejam:assets') return '\0gamejam-assets';
          if (specifier.startsWith('\0')) fail('지원하지 않는 가상 모듈');
          if (!importer && specifier === path.join(sourceRoot, plan.entry))
            return specifier;
          if (/^(?:[a-z][a-z0-9+.-]*:|[\\/])/.test(specifier))
            fail(`외부/절대/Node import는 지원하지 않습니다: ${specifier}`);
          const from = importer ? owner(importer) : undefined;
          const bare = !specifier.startsWith('.');
          if (bare && !from) {
            const root = specifier.startsWith('@')
              ? specifier.split('/').slice(0, 2).join('/')
              : specifier.split('/')[0];
            if (!Object.hasOwn(input.lock.roots, root))
              fail(`준비 계획에 없는 의존성: ${root}`);
            const location = dependencyRoot
              ? path.join(dependencyRoot, input.lock.roots[root])
              : fail('준비된 의존성 폴더가 없습니다.');
            const sub = specifier.slice(root.length);
            // Resolve package exports from a synthetic importer located beside the prepared roots.
            const resolved = await this.resolve(
              specifier,
              path.join(dependencyRoot!, '__gamejam_entry__.js'),
              { skipSelf: true },
            );
            if (!resolved || resolved.external)
              fail(`브라우저 모듈을 찾지 못했습니다: ${root}${sub}`);
            const real = await fs.realpath(resolved.id);
            if (
              !inside(real, location) ||
              owner(real)?.key !== input.lock.roots[root]
            )
              fail('선택한 package 범위 밖 모듈');
            return real;
          }
          const resolved = await this.resolve(specifier, importer, {
            skipSelf: true,
          });
          if (!resolved || resolved.external)
            fail(`모듈을 찾지 못했습니다: ${specifier}`);
          const real = await fs.realpath(resolved.id),
            target = owner(real);
          if (inside(real, sourceRoot)) {
            if (
              from ||
              !Object.hasOwn(
                sources,
                path.relative(sourceRoot, real).split(path.sep).join('/'),
              )
            )
              fail('선언한 소스 범위 밖 import');
          } else if (
            !from ||
            !target ||
            (target.key !== from.key && !from.dependencies.includes(target.key))
          )
            fail('고정 graph 밖 의존성 import');
          if (!/\.(?:[cm]?js|json|css)$/.test(real))
            fail('지원하지 않는 모듈 형식: ' + specifier);
          return real;
        },
        async load(id) {
          if (id === '\0gamejam-assets')
            return 'export default globalThis.__GAMEJAM_EMBEDDED_ASSETS_V1__;';
          if (id.endsWith('.css'))
            return {
              code: `const text=${json(css(await fs.readFile(id, 'utf8')))};const style=document.createElement('style');style.textContent=text;document.head.appendChild(style);export default text;`,
              moduleType: 'js',
              moduleSideEffects: 'no-treeshake',
            };
        },
      },
    ],
    onwarn(w) {
      if (w.code !== 'CIRCULAR_DEPENDENCY') fail(w.message);
    },
  });
  let code = '',
    styles = '';
  try {
    const result = await bundle.generate({
      format: 'iife',
      inlineDynamicImports: true,
      sourcemap: false,
      minify: false,
    });
    for (const item of result.output) {
      if (item.type === 'chunk') {
        if (code) fail('HTML 하나에 포함할 수 없는 분할 모듈');
        code = item.code;
      } else if (item.fileName.endsWith('.css'))
        styles += css(
          typeof item.source === 'string'
            ? item.source
            : Buffer.from(item.source).toString('utf8'),
        );
      else fail('내장하지 못한 빌드 리소스: ' + item.fileName);
    }
  } finally {
    await bundle.close();
  }
  if (!code) fail('실행할 JavaScript가 없습니다.');
  const nodes: unknown[] = [
    parseJavaScript(code, { ecmaVersion: 'latest', sourceType: 'script' }),
  ];
  while (nodes.length) {
    const node = nodes.pop();
    if (!node || typeof node !== 'object') continue;
    if ('type' in node && node.type === 'ImportExpression')
      fail(
        '빌드에 포함되지 않은 동적 import는 지원하지 않습니다. 준비한 모듈을 정적 import해주세요.',
      );
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const item of value) nodes.push(item);
      } else if (value && typeof value === 'object') nodes.push(value);
    }
  }
  const doc = parse(sources[plan.html]);
  let scripts = 0;
  const replace = (node: DefaultTreeAdapterMap['element'], html: string) => {
    const parent = node.parentNode!;
    const replacement = parseFragment(html).childNodes[0];
    replacement.parentNode = parent;
    parent.childNodes.splice(parent.childNodes.indexOf(node), 1, replacement);
  };
  const visit = async (node: Node): Promise<void> => {
    if ('tagName' in node) {
      const attrs = Object.fromEntries(
        node.attrs.map((a) => [a.name, a.value]),
      );
      if (
        ['iframe', 'object', 'embed', 'base', 'template'].includes(
          node.tagName,
        ) ||
        (node.tagName === 'meta' && attrs['http-equiv'])
      )
        fail('지원하지 않는 HTML 실행/탐색 요소: ' + node.tagName);
      if (node.tagName === 'script') {
        if (attrs.type === 'application/json' && !attrs.src) return;
        if (
          attrs.type !== 'module' ||
          attrs.src !== `./${plan.entry}` ||
          ++scripts !== 1
        )
          fail('HTML에는 entry를 가리키는 module script 하나만 작성해주세요.');
        const assetPrelude = `globalThis.__GAMEJAM_EMBEDDED_ASSETS_V1__=Object.freeze(JSON.parse(${json(JSON.stringify(input.assets))}));for(const [key,value]of Object.entries(globalThis.__GAMEJAM_EMBEDDED_ASSETS_V1__))document.documentElement.style.setProperty('--gamejam-asset-'+key,'url("'+value+'")');for(const element of document.querySelectorAll('*'))for(const attr of [...element.attributes])if(attr.name.startsWith('data-gamejam-asset-')){const value=globalThis.__GAMEJAM_EMBEDDED_ASSETS_V1__[attr.value];if(!value)throw Error('Missing embedded asset');element.setAttribute(attr.name.slice(19),value);element.removeAttribute(attr.name);}`;
        replace(
          node,
          `<script type="module">${(assetPrelude + code).replace(/<\/script/gi, '<\\/script')}</script>`,
        );
        return;
      }
      if (node.tagName === 'link') {
        if (
          attrs.rel !== 'stylesheet' ||
          !attrs.href?.startsWith('./') ||
          sources[attrs.href.slice(2)] === undefined ||
          !attrs.href.endsWith('.css')
        )
          fail('내장하지 못한 stylesheet/link');
        replace(
          node,
          `<style>${css(sources[attrs.href.slice(2)]).replace(/<\/style/gi, '<\\/style')}</style>`,
        );
        return;
      }
      if (node.tagName === 'style') {
        const text = node.childNodes
          .filter((n): n is DefaultTreeAdapterMap['textNode'] => 'value' in n)
          .map((n) => n.value)
          .join('');
        replace(
          node,
          `<style>${css(text).replace(/<\/style/gi, '<\\/style')}</style>`,
        );
        return;
      }
      for (const attr of node.attrs) {
        if (
          [
            'src',
            'href',
            'poster',
            'data',
            'action',
            'formaction',
            'xlink:href',
          ].includes(attr.name)
        ) {
          if (attr.value.startsWith('gamejam:asset/')) {
            asset(attr.value);
            attr.name = 'data-gamejam-asset-' + attr.name;
            attr.value = attr.value.slice(14);
          } else attr.value = resource(attr.value);
        }
        if (['srcset', 'srcdoc'].includes(attr.name))
          fail('srcset/srcdoc 대신 선언한 단일 이미지를 사용해주세요.');
        if (attr.name === 'style')
          attr.value = css('x{' + attr.value + '}').slice(2, -1);
      }
    }
    if ('childNodes' in node)
      for (const child of node.childNodes) await visit(child);
  };
  await visit(doc);
  if (scripts !== 1) fail('HTML의 module entry가 누락되었습니다.');
  const head = doc.childNodes
    .find(
      (n): n is DefaultTreeAdapterMap['element'] =>
        'tagName' in n && n.tagName === 'html',
    )!
    .childNodes.find(
      (n): n is DefaultTreeAdapterMap['element'] =>
        'tagName' in n && n.tagName === 'head',
    )!;
  const additions = parseFragment(
    `<meta http-equiv="Content-Security-Policy" content="${csp}"><style>${styles.replace(/<\/style/gi, '<\\/style')}</style><script type="application/json" id="gamejam-build-provenance">${json({ version: 1, profile, toolsetSha256: input.toolsetSha256, dependencies: input.lock })}</script><script type="application/json" id="gamejam-license-notices">${json(input.notices)}</script>`,
  ).childNodes;
  for (const node of additions) node.parentNode = head;
  head.childNodes.unshift(...additions);
  const html =
    '<!doctype html>\n' + serialize(doc).replace(/^<!DOCTYPE html>/i, '');
  if (!input.local && Buffer.byteLength(html) > GameBuildLimits.htmlBytes)
    fail('내장 HTML이 현재 8MB 한도를 초과합니다.');
  return { html, toolsetSha256: input.toolsetSha256, profile };
}
try {
  // The parent writes this private input file; no AI configuration or code is imported.
  const input = JSON.parse(
    await fs.readFile('build-input.json', 'utf8'),
  ) as Input;
  const result = await main(input);
  if (input.local) {
    const { html, ...metadata } = result;
    await fs.writeFile('built-game.html', html, { flag: 'wx' });
    process.stdout.write(JSON.stringify({ result: metadata }));
  } else {
    process.stdout.write(JSON.stringify({ result }));
  }
} catch (cause) {
  process.stdout.write(
    JSON.stringify({
      error: {
        message:
          cause instanceof Error ? cause.message.slice(0, 2000) : String(cause),
      },
    }),
  );
  process.exitCode = 1;
}
