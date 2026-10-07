export type NewFileIndicators = { known: string[]; unread: string[] };

export function readNewFileIndicators(
  raw: string | null,
): NewFileIndicators | undefined {
  try {
    const value = JSON.parse(raw ?? 'null');
    if (
      Array.isArray(value?.known) &&
      Array.isArray(value?.unread) &&
      [...value.known, ...value.unread].every((id) => typeof id === 'string')
    )
      return value;
  } catch {
    /* Keep the canvas usable if local preferences cannot be read. */
  }
}

/** First visit establishes a baseline; later additions glow until acknowledged. */
export function updateNewFileIndicators(
  previous: NewFileIndicators | undefined,
  ids: string[],
  aliases: Record<string, string> = {},
): NewFileIndicators {
  const resolve = (id: string) =>
    Object.hasOwn(aliases, id) ? aliases[id] : id;
  const known = new Set(previous?.known.map(resolve) ?? ids);
  const visible = new Set(ids);
  const unread = new Set(
    (previous?.unread ?? []).map(resolve).filter((id) => visible.has(id)),
  );
  for (const id of ids) {
    if (!known.has(id)) unread.add(id);
    known.add(id);
  }
  return { known: [...known], unread: [...unread] };
}
