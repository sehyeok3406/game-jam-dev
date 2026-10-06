export const CARD_COLORS = [
  { id: 'default', label: '기본' },
  { id: 'yellow', label: '노랑' },
  { id: 'green', label: '초록' },
  { id: 'blue', label: '파랑' },
  { id: 'purple', label: '보라' },
  { id: 'pink', label: '분홍' },
  { id: 'gray', label: '회색' },
] as const;
export type CardColor = (typeof CARD_COLORS)[number]['id'];
export function cardColor(value: unknown): CardColor {
  return CARD_COLORS.find((item) => item.id === value)?.id ?? 'default';
}
