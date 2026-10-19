export type MaterialDirection = 'left' | 'right' | 'up' | 'down';

/** Physical key positions work with Korean input, Shift and Caps Lock. */
export function materialNavigation(event: {
  code: string;
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): MaterialDirection | 'toggle' | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const keys: Record<string, MaterialDirection | 'toggle'> = {
    KeyW: 'up',
    KeyA: 'left',
    KeyS: 'down',
    KeyD: 'right',
    ArrowUp: 'up',
    ArrowLeft: 'left',
    ArrowDown: 'down',
    ArrowRight: 'right',
    Space: 'toggle',
  };
  return keys[event.code] ?? keys[event.key] ?? null;
}

export type MaterialPoint = { id: string; x: number; y: number };

/** Prefer the nearest item in the requested direction, with a penalty for sideways travel. */
export function nextMaterial(
  items: MaterialPoint[],
  current: string | null,
  direction: MaterialDirection,
  origin: { x: number; y: number },
) {
  const from = items.find((item) => item.id === current) ?? origin;
  const horizontal = direction === 'left' || direction === 'right';
  const sign = direction === 'left' || direction === 'up' ? -1 : 1;
  const candidates = items.filter((item) => item.id !== current);
  if (!current || !items.some((item) => item.id === current))
    return candidates.sort(
      (a, b) =>
        Math.hypot(a.x - from.x, a.y - from.y) -
          Math.hypot(b.x - from.x, b.y - from.y) || a.id.localeCompare(b.id),
    )[0]?.id;
  return candidates
    .map((item) => {
      const forward =
        ((horizontal ? item.x : item.y) - (horizontal ? from.x : from.y)) *
        sign;
      const sideways = Math.abs(
        (horizontal ? item.y : item.x) - (horizontal ? from.y : from.x),
      );
      return {
        id: item.id,
        forward,
        score: Math.hypot(forward, sideways) + sideways * 2,
      };
    })
    .filter((item) => item.forward > 0)
    .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))[0]?.id;
}
