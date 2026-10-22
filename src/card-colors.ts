import type { CardColor } from './contracts/card-colors.ts';
export type { CardColor } from './contracts/card-colors.ts';
import { CARD_COLORS } from './contracts/card-colors.ts';
export { CARD_COLORS } from './contracts/card-colors.ts';
export function cardColor(value: unknown): CardColor {
  return CARD_COLORS.find((item) => item.id === value)?.id ?? 'default';
}
