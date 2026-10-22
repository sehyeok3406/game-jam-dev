import matter from '../../markdown.ts';
import type { MarkdownCodec } from '../../application/ports/markdown-codec.ts';
export const markdownCodec: MarkdownCodec = {
  parse: matter,
  stringify: (content, data) => matter.stringify(content, data),
};
