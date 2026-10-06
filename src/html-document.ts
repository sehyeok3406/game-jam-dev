import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5';
import { CanvasError } from './app-errors.ts';
type Node = DefaultTreeAdapterMap['node'];
export function inspectHtml(content: string, relativePath?: string) {
  if (
    !content.trim() ||
    /^\s*```/.test(content) ||
    !/<(?:!doctype\s+html|[a-z][\w:-]*(?:\s|>))/i.test(content)
  )
    throw new CanvasError(
      'GC-HTML-001',
      'HTML 문서 형식을 확인해주세요. 코드 블록·설명문·빈 파일은 실행할 수 없습니다.',
      { relativePath },
    );
  const document = parse(content);
  const find = (
    node: Node,
    tag: string,
  ): DefaultTreeAdapterMap['element'] | undefined => {
    if ('tagName' in node && node.tagName === tag) return node;
    if ('childNodes' in node)
      for (const child of node.childNodes) {
        const result = find(child, tag);
        if (result) return result;
      }
  };
  const body = find(document, 'body');
  if (
    !body ||
    (!body.childNodes.some(
      (node) => 'tagName' in node || ('value' in node && node.value.trim()),
    ) &&
      !find(document, 'script'))
  )
    throw new CanvasError(
      'GC-HTML-005',
      'HTML 문서에 실행할 화면 내용이 없습니다.',
      { relativePath },
    );
  return {
    normalized: serialize(document),
    explicitBody: /<body(?:\s|>)/i.test(content),
    implicitBody: !/<body(?:\s|>)/i.test(content),
    bodyNodes: body.childNodes.length,
  };
}
