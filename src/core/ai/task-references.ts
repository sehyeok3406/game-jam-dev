type Codec = {
  parse(raw: string): { data: Record<string, unknown>; content: string };
  stringify(body: string, data: Record<string, unknown>): string;
};
const pathFields = new Set([
  'id',
  'path',
  'relativePath',
  'basePath',
  'baseDir',
  'overview',
  'taskPath',
  'html_source',
  'base_html',
  'document_base_dir',
]);
const pathArrays = new Set([
  'inputs',
  'inputPaths',
  'expected_outputs',
  'originalInputs',
  'designDocuments',
  'paths',
]);
const frozenFields = new Set([
  'effective_instructions',
  'instructionOrigins',
  'originalInstructions',
  'instructions',
]);
/** Relocation updates live references, never the user's frozen prose or instruction digests. */
export function remapTaskReferences(
  raw: string,
  replacements: Readonly<Record<string, string>>,
  codec: Codec,
): string | null {
  const parsed = codec.parse(raw);
  if (parsed.data.instruction_template_version !== 2) return null;
  const remap = (value: unknown, field = ''): unknown => {
    if (frozenFields.has(field)) return value;
    if (typeof value === 'string') {
      if (field === 'workflow_steps')
        return remapTaskReferences(value, replacements, codec) ?? value;
      return pathFields.has(field) || pathArrays.has(field)
        ? (replacements[value] ?? value)
        : value;
    }
    if (Array.isArray(value)) return value.map((item) => remap(item, field));
    if (!value || typeof value !== 'object') return value;
    const mapped = Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, remap(child, key)]),
    );
    if (
      typeof mapped.overview === 'string' &&
      mapped.overview.endsWith('game-overview.md') &&
      typeof mapped.systemPrefix === 'string'
    )
      mapped.systemPrefix =
        mapped.overview.slice(0, -'game-overview.md'.length) + 'system-';
    return mapped;
  };
  const data = remap(parsed.data) as Record<string, unknown>;
  const pattern = Object.keys(replacements)
    .sort((a, b) => b.length - a.length)
    .map((path) => path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  if (!pattern) return raw;
  const substitute = (text: string) =>
    text.replace(new RegExp(pattern, 'g'), (value) => replacements[value]);
  const protectedRanges: [number, number][] = [];
  for (const [start, end] of [
    ['## 사용자 작업 지시\n\n', '\n\n## 고정 보호 규칙\n'],
    ['## 1. 문서 정리 지시\n\n', '\n\n## 2. HTML 구현 지시\n'],
    ['## 2. HTML 구현 지시\n\n', '\n\n## 출력\n'],
  ]) {
    const from = parsed.content.indexOf(start),
      to = parsed.content.lastIndexOf(end);
    if (from >= 0 && to > from) protectedRanges.push([from + start.length, to]);
  }
  // The JSON context includes original user prose, so regenerate that line from typed fields.
  const contextLine = /^- 원본 요구와 설계 기준의 고정 정보: .*$/gm;
  const contextEdits = new Map<number, string>();
  for (const match of parsed.content.matchAll(contextLine)) {
    if (
      protectedRanges.some(
        ([from, to]) => match.index >= from && match.index < to,
      )
    )
      continue;
    protectedRanges.push([match.index, match.index + match[0].length]);
    if (data.task_context)
      contextEdits.set(
        match.index,
        '- 원본 요구와 설계 기준의 고정 정보: ' +
          JSON.stringify(data.task_context),
      );
  }
  protectedRanges.sort((a, b) => a[0] - b[0]);
  let body = '',
    cursor = 0;
  for (const [from, to] of protectedRanges) {
    if (from < cursor) continue;
    body +=
      substitute(parsed.content.slice(cursor, from)) +
      (contextEdits.get(from) ?? parsed.content.slice(from, to));
    cursor = to;
  }
  body += substitute(parsed.content.slice(cursor));
  return body === parsed.content &&
    JSON.stringify(data) === JSON.stringify(parsed.data)
    ? raw
    : codec.stringify(body, data);
}
