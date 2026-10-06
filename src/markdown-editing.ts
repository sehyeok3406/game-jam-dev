import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

const parser = unified().use(remarkParse).use(remarkGfm);
const supported = new Set([
  'root',
  'paragraph',
  'text',
  'heading',
  'list',
  'listItem',
  'strong',
  'emphasis',
  'delete',
  'inlineCode',
  'code',
  'blockquote',
  'thematicBreak',
  'table',
  'tableRow',
  'tableCell',
  'link',
  'image',
  'break',
]);

/** Compare meaning, not bullet characters, indentation or blank lines. */
export function markdownMeaning(body: string): string | null {
  let safe = true;
  const tree = parser.parse(body);
  const result = JSON.stringify(tree, (key, value) => {
    if (key === 'position' || key === 'spread') return undefined;
    if (key === 'type' && !supported.has(value)) safe = false;
    if (key === 'meta' && value) safe = false;
    return value;
  });
  return safe ? result : null;
}

export function canEditMarkdownVisually(body: string, roundTrip: string) {
  const meaning = markdownMeaning(body);
  return meaning !== null && meaning === markdownMeaning(roundTrip);
}

/** The offset comes from the parsed list item, never from a text search. */
export function setMarkdownTaskChecked(
  body: string,
  offset: number,
  checked: boolean,
) {
  if (!Number.isInteger(offset) || offset < 0 || offset >= body.length)
    throw new Error(
      '체크리스트 위치를 찾지 못했습니다. 문서를 다시 열어주세요.',
    );
  const match = /^(?:[-+*]|\d+[.)])[ \t]+\[([ xX])\](?=[ \t\r\n]|$)/.exec(
    body.slice(offset),
  );
  if (!match)
    throw new Error('체크리스트가 변경되었습니다. 문서를 다시 열어주세요.');
  const index = offset + match[0].lastIndexOf('[') + 1;
  return body.slice(0, index) + (checked ? 'x' : ' ') + body.slice(index + 1);
}

export const MARKDOWN_HELP =
  '#~###### + Space: 제목 · - / * / + + Space: 글머리 · 1. + Space: 번호 · [] / [ ] / [x] + Space: 체크 · > + Space: 인용 · --- + Space: 구분선';
