export type MiniMapPreferences = { transparency: number; shade: number };
export const defaultMiniMapPreferences: MiniMapPreferences = {
  transparency: 0,
  shade: 18,
};
export function readMiniMapPreferences(raw: unknown): MiniMapPreferences {
  const v =
    raw && typeof raw === 'object' ? (raw as Partial<MiniMapPreferences>) : {};
  const value = (n: unknown, f: number, max: number) =>
    typeof n === 'number' && Number.isFinite(n)
      ? Math.max(0, Math.min(max, n))
      : f;
  return {
    transparency: value(v.transparency, 0, 90),
    shade: value(v.shade, 18, 60),
  };
}
