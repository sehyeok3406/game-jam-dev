import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { parse as parseJavaScript } from 'acorn';

type Syntax = { type: string; [key: string]: unknown };
const node = (value: unknown): Syntax | undefined =>
  value && typeof value === 'object' && 'type' in value
    ? (value as Syntax)
    : undefined;
const name = (value: unknown): string | undefined => {
  const part = node(value);
  if (part?.type === 'Identifier') return part.name as string;
  if (part?.type === 'MemberExpression') {
    const property = node(part.property);
    return part.computed
      ? (property?.value as string | undefined)
      : (property?.name as string | undefined);
  }
  return undefined;
};

// Inspect executable code only. A tutorial, comment or JSON string mentioning
// WebRTC must not prevent an unrelated game from being opened or generated.
const cache: { html: string; result: boolean }[] = [];
export function usesIndependentConnection(html: string): boolean {
  const cached = cache.find((item) => item.html === html);
  if (cached) return cached.result;
  let found = false;
  const visitSyntax = (value: unknown) => {
    const part = node(value);
    if (!part || found) return;
    if (
      (part.type === 'NewExpression' || part.type === 'CallExpression') &&
      /^(?:RTCPeerConnection|webkitRTCPeerConnection|mozRTCPeerConnection|WebSocket)$/.test(
        name(part.callee) ?? '',
      )
    )
      found = true;
    for (const child of Object.values(part)) {
      if (Array.isArray(child)) child.forEach(visitSyntax);
      else visitSyntax(child);
    }
  };
  const script = (source: string, module = false) => {
    if (!/RTCPeerConnection|WebSocket/.test(source)) return;
    try {
      visitSyntax(
        parseJavaScript(source, {
          ecmaVersion: 'latest',
          sourceType: module ? 'module' : 'script',
          allowReturnOutsideFunction: true,
        }),
      );
    } catch {
      // The normal HTML runtime validation reports syntax errors separately.
    }
  };
  const visit = (part: DefaultTreeAdapterMap['node']) => {
    if ('tagName' in part) {
      const type =
        part.attrs.find((attr) => attr.name === 'type')?.value.toLowerCase() ??
        '';
      if (
        part.tagName === 'script' &&
        ['', 'module', 'text/javascript', 'application/javascript'].includes(
          type,
        )
      ) {
        script(
          part.childNodes
            .map((child) => ('value' in child ? child.value : ''))
            .join(''),
          type === 'module',
        );
      }
      for (const attr of part.attrs)
        if (/^on/i.test(attr.name)) script(attr.value);
    }
    if ('childNodes' in part) part.childNodes.forEach(visit);
  };
  visit(parse(html));
  if (html.length <= 1024 * 1024) {
    cache.push({ html, result: found });
    if (cache.length > 8) cache.shift();
  }
  return found;
}
