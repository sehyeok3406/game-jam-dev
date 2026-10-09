import type { GamejamField } from './gamejam-validation';

export const GAMEJAM_PAGES = [
  { number: 1, label: '작업·입력' },
  { number: 2, label: '결과 설정' },
  { number: 3, label: '작업 지침' },
  { number: 4, label: '기능 라이브러리' },
  { number: 5, label: '최종 확인' },
] as const;
export type GamejamPage = (typeof GAMEJAM_PAGES)[number]['number'];

export const gamejamFieldPage = (field: GamejamField): GamejamPage => {
  switch (field) {
    case 'steps':
      return 1;
    case 'name':
    case 'html-result':
      return 2;
    case 'organize':
    case 'implement':
      return 3;
    default:
      return 5;
  }
};
