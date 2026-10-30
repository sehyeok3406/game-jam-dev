const normalize = (segments: string[]) => {
  const result: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..' && result.length && result.at(-1) !== '..')
      result.pop();
    else result.push(segment);
  }
  return result;
};

/** Project links use forward slashes on every platform, including the browser runtime. */
export function rebaseProjectLink(
  from: string,
  to: string,
  destination: string,
  aliases: Record<string, string>,
) {
  const original = normalize([
    ...from.split('/').slice(0, -1),
    ...destination.split('/'),
  ]).join('/');
  if (from === to && !Object.hasOwn(aliases, original)) return null;
  const target = normalize((aliases[original] ?? original).split('/'));
  const directory = normalize(to.split('/').slice(0, -1));
  let common = 0;
  while (
    common < directory.length &&
    common < target.length &&
    directory[common] === target[common]
  )
    common++;
  return (
    [...directory.slice(common).map(() => '..'), ...target.slice(common)].join(
      '/',
    ) || '.'
  );
}
