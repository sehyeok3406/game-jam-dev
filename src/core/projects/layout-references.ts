const pathFields = new Set([
  'path',
  'relativePath',
  'descriptionPath',
  'overview',
  'baseDir',
  'taskPath',
  'sourcePath',
]);
const pathArrays = new Set([
  'inputs',
  'expected_outputs',
  'inputPaths',
  'paths',
  'workflow_steps',
]);
/** Only typed path fields and path-keyed indices change; arbitrary prose is untouched. */
export function remapLayoutReferences(
  value: unknown,
  aliases: Record<string, string>,
  field = '',
): unknown {
  if (typeof value === 'string')
    return pathFields.has(field) || pathArrays.has(field)
      ? (aliases[value] ?? value)
      : value;
  if (Array.isArray(value))
    return value.map((v) => remapLayoutReferences(v, aliases, field));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      aliases[key] ?? key,
      remapLayoutReferences(child, aliases, key),
    ]),
  );
}
