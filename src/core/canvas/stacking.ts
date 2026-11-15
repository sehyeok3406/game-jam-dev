export type StackMove = 'forward' | 'backward' | 'front' | 'back';

export function readCanvasStacking(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 10_000 ||
    value.some(
      (key: unknown) =>
        typeof key !== 'string' ||
        key.length > 4096 ||
        !/^(document|html|drawing|game-ui):.+$/.test(key),
    ) ||
    new Set(value).size !== value.length
  )
    throw new Error('요소의 쌓임 순서를 확인해주세요.');
  return [...value];
}

/** Orders are back to front. Both selected and unselected relative orders stay stable. */
export function moveCanvasStack(
  order: readonly string[],
  selected: ReadonlySet<string>,
  move: StackMove,
): string[] {
  if (move === 'front' || move === 'back') {
    const moving = order.filter((key) => selected.has(key));
    const remaining = order.filter((key) => !selected.has(key));
    return move === 'front'
      ? [...remaining, ...moving]
      : [...moving, ...remaining];
  }
  const next = [...order];
  const direction = move === 'forward' ? 1 : -1;
  // Visit front to back when moving forward so each item crosses only one neighbor.
  for (
    let index = direction === 1 ? next.length - 2 : 1;
    index >= 0 && index < next.length;
    index -= direction
  ) {
    const neighbor = index + direction;
    if (selected.has(next[index]) && !selected.has(next[neighbor]))
      [next[index], next[neighbor]] = [next[neighbor], next[index]];
  }
  return next;
}
