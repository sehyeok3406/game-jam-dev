import { ApiError } from './errors.ts';
export function createRateLimit(now: () => number = Date.now) {
  const rates = new Map<string, { count: number; until: number }>();
  const limit = (identity: string, category: string, max: number) => {
    const key = `${identity}:${category}`;
    for (const [key, value] of rates)
      if (value.until < now()) rates.delete(key);
    if (!rates.has(key) && rates.size >= 10000)
      throw new ApiError('서버가 혼잡합니다. 잠시 후 다시 시도해주세요.', 429);
    const current = rates.get(key);
    const value =
      current && current.until > now()
        ? current
        : { count: 0, until: now() + 60000 };
    rates.set(key, value);
    if (++value.count > max)
      throw new ApiError(
        '입력 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.',
        429,
      );
  };
  return limit;
}
