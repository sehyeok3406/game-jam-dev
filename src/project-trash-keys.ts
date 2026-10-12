export function projectStorageKey(key: string, identities: string[]) {
  return identities.some(
    (id) =>
      key.startsWith(`game-canvas-draft:${id}:`) ||
      key.startsWith(`game-canvas-sheet-view:${id}:`) ||
      key === `game-canvas-active-sheet:${id}` ||
      key === `game-canvas-new-files:${id}` ||
      (key.startsWith('game-canvas-') &&
        (key.endsWith(`:${id}`) || key.includes(`:${id}:`))),
  );
}
