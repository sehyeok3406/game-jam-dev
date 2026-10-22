export type LayoutValues = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export function layoutValues(
  current: Record<string, unknown>,
  input: Record<string, unknown>,
): LayoutValues {
  const number = (value: unknown) => {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      Math.abs(value) > 1_000_000
    )
      throw Error('캔버스 좌표/크기가 올바르지 않습니다.');
    return Math.round(value);
  };
  const x = number(input.position === false ? current.x : input.x);
  const y = number(input.position === false ? current.y : input.y);
  const width = number(input.size === false ? current.width : input.width);
  const height = number(input.size === false ? current.height : input.height);
  if (width < 120 || height < 38) throw Error('창 크기가 너무 작습니다.');
  return { x, y, width, height };
}
