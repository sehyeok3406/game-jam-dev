import { parse as parseHtml, type DefaultTreeAdapterMap } from 'parse5';
import { parse as parseJavaScript } from 'acorn';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';

type SyntaxNode = { type: string; [key: string]: unknown };
const syntaxNode = (value: unknown): SyntaxNode | undefined =>
  value && typeof value === 'object' && 'type' in value
    ? (value as SyntaxNode)
    : undefined;
const stringLiteral = (value: unknown): string | undefined => {
  const node = syntaxNode(value);
  if (node?.type === 'Literal' && typeof node.value === 'string')
    return node.value;
  if (
    node?.type === 'TemplateLiteral' &&
    !(node.expressions as unknown[]).length
  )
    return ((node.quasis as SyntaxNode[])[0].value as { cooked?: string })
      .cooked;
  return undefined;
};
const memberName = (value: unknown) => {
  const node = syntaxNode(value);
  if (node?.type !== 'MemberExpression') return undefined;
  return node.computed
    ? stringLiteral(node.property)
    : syntaxNode(node.property)?.name;
};
const cssUnescape = (value: string) =>
  value.replace(/\\([\da-f]{1,6})\s?|\\([^\r\n])/gi, (_, hex, character) => {
    if (!hex) return character;
    const code = Number.parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd';
  });

// Workspace refreshes repeatedly inspect unchanged game bundles. Bound retained
// source text and never return the cached array to a caller that could mutate it.
const referenceCache: {
  content: string;
  kind: string;
  references: string[];
}[] = [];

/** Inspect syntax only: do not evaluate scripts, resolve variables or fetch URLs. */
export function htmlReferences(content: string, kind: 'html' | 'css' | 'js') {
  const cached = referenceCache.find(
    (item) => item.content === content && item.kind === kind,
  );
  if (cached) return [...cached.references];
  const result = new Set<string>();
  const add = (value: string | undefined) => {
    const ref = value?.trim();
    if (ref && !/^(?:data:|blob:|#)/i.test(ref)) result.add(ref);
  };
  const cssValue = (value: string, isImport = false) => {
    const parsed = valueParser(value);
    if (isImport) {
      const first = parsed.nodes.find(
        (node) => node.type !== 'space' && node.type !== 'comment',
      );
      if (first?.type === 'string') add(cssUnescape(first.value));
    }
    parsed.walk((node) => {
      if (node.type !== 'function' || node.value.toLowerCase() !== 'url')
        return;
      if (
        node.nodes.length === 1 &&
        ['word', 'string'].includes(node.nodes[0].type)
      )
        add(cssUnescape(node.nodes[0].value));
      else if (node.nodes.every((part) => ['word', 'div'].includes(part.type)))
        add(cssUnescape(valueParser.stringify(node.nodes)));
      return false;
    });
  };
  const css = (source: string) => {
    try {
      const root = postcss.parse(source);
      root.walkDecls((declaration) => cssValue(declaration.value));
      root.walkAtRules(/^import$/i, (rule) => cssValue(rule.params, true));
    } catch {
      // Malformed CSS is not evidence of an external file reference.
    }
  };
  const javascript = (source: string) => {
    let root;
    try {
      root = parseJavaScript(source, {
        ecmaVersion: 'latest',
        sourceType: 'module',
      });
    } catch {
      try {
        root = parseJavaScript(source, {
          ecmaVersion: 'latest',
          sourceType: 'script',
        });
      } catch {
        return; // An unparseable script is not an external dependency.
      }
    }
    const pending: unknown[] = [root];
    while (pending.length) {
      const node = syntaxNode(pending.pop());
      if (!node) continue;
      if (
        [
          'ImportDeclaration',
          'ExportNamedDeclaration',
          'ExportAllDeclaration',
          'ImportExpression',
        ].includes(node.type)
      )
        add(stringLiteral(node.source));
      if (node.type === 'CallExpression' || node.type === 'NewExpression') {
        const callee = syntaxNode(node.callee);
        const args = node.arguments as unknown[];
        const name = callee?.type === 'Identifier' ? callee.name : undefined;
        const property = memberName(callee);
        const receiver = syntaxNode(callee?.object);
        const base = syntaxNode(args[1]);
        const meta = syntaxNode(base?.object);
        const moduleUrl =
          name === 'URL' &&
          memberName(base) === 'url' &&
          meta?.type === 'MetaProperty' &&
          syntaxNode(meta.meta)?.name === 'import';
        if (
          (node.type === 'CallExpression' &&
            (name === 'fetch' ||
              name === 'importScripts' ||
              (property === 'fetch' &&
                ['window', 'self', 'globalThis'].includes(
                  String(receiver?.name),
                )))) ||
          (node.type === 'NewExpression' &&
            (['Worker', 'SharedWorker', 'Audio'].includes(String(name)) ||
              moduleUrl))
        ) {
          for (const argument of name === 'importScripts'
            ? args
            : args.slice(0, 1))
            add(stringLiteral(argument));
        }
        if (
          property === 'setAttribute' &&
          ['src', 'href', 'poster'].includes(stringLiteral(args[0]) ?? '')
        )
          add(stringLiteral(args[1]));
        if (
          property === 'open' &&
          ['GET', 'POST', 'HEAD', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'].includes(
            (stringLiteral(args[0]) ?? '').toUpperCase(),
          )
        )
          add(stringLiteral(args[1]));
      }
      if (
        node.type === 'AssignmentExpression' &&
        ['src', 'href', 'poster'].includes(String(memberName(node.left)))
      )
        add(stringLiteral(node.right));
      for (const value of Object.values(node)) {
        if (Array.isArray(value))
          for (const child of value) pending.push(child);
        else if (syntaxNode(value)) pending.push(value);
      }
    }
  };
  if (kind === 'css') css(content);
  else if (kind === 'js') javascript(content);
  else {
    const pending: DefaultTreeAdapterMap['node'][] = [parseHtml(content)];
    while (pending.length) {
      const node = pending.pop()!;
      if ('attrs' in node) {
        for (const attr of node.attrs) {
          if (
            ['src', 'href', 'poster'].includes(attr.name) &&
            !(node.tagName === 'a' && attr.name === 'href')
          )
            add(attr.value);
          if (attr.name === 'srcset') {
            // HTML srcset URLs end at whitespace; data URLs may contain commas.
            let remaining = attr.value;
            while (remaining) {
              remaining = remaining.replace(/^[\s,]+/, '');
              const url = /^[^\s]+/.exec(remaining)?.[0];
              if (!url) break;
              add(url.replace(/,+$/, ''));
              remaining = remaining.slice(url.length);
              if (!url.endsWith(',')) {
                const comma = remaining.indexOf(',');
                remaining = comma < 0 ? '' : remaining.slice(comma + 1);
              }
            }
          }
          if (attr.name === 'style') css(`x{${attr.value}}`);
        }
        const text =
          'childNodes' in node
            ? node.childNodes
                .filter((child) => child.nodeName === '#text')
                .map(
                  (child) => (child as DefaultTreeAdapterMap['textNode']).value,
                )
                .join('')
            : '';
        if (node.tagName === 'style') css(text);
        if (node.tagName === 'script') {
          const type = node.attrs
            .find((attr) => attr.name === 'type')
            ?.value.trim()
            .toLowerCase();
          if (
            !type ||
            type === 'module' ||
            /^(?:text|application)\/(?:java|ecma)script$/.test(type)
          )
            javascript(text);
        }
      }
      if ('childNodes' in node)
        for (const child of node.childNodes) pending.push(child);
    }
  }
  const references = [...result];
  referenceCache.push({ content, kind, references });
  while (
    referenceCache.length > 4 ||
    referenceCache.reduce((size, item) => size + item.content.length, 0) >
      8_000_000
  )
    referenceCache.shift();
  return [...references];
}
