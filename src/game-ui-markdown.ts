import yaml from 'js-yaml';
const { safeLoad, safeDump } = yaml;
/** String-only, safe YAML adapter shared with the browser's optimistic reducer. */
function read(raw: string): { data: Record<string, any>; content: string } {
  const source = raw.replace(/^\uFEFF/, '');
  const match = /^---(?:yaml|yml)?\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(
    source,
  );
  if (!match) return { data: {}, content: source };
  const value = safeLoad(match[1]);
  if (
    value !== undefined &&
    value !== null &&
    (typeof value !== 'object' || Array.isArray(value))
  )
    throw new Error('UI 설명 문서의 속성이 올바르지 않습니다.');
  return {
    data: (value ?? {}) as Record<string, any>,
    content: source.slice(match[0].length),
  };
}
export default Object.assign(read, {
  stringify: (body: string, data: Record<string, unknown>) =>
    `---\n${safeDump(data, { noRefs: true, lineWidth: -1 })}---\n${body}`,
});
