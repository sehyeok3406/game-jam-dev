import type { GameUiFrame } from './contracts/game-ui-types.ts';
export type { GameUiFrame } from './contracts/game-ui-types.ts';
export type { GameUiItem } from './contracts/game-ui-types.ts';
export type { GameUiDetails } from './contracts/game-ui-types.ts';
export type { GameUiStyle } from './contracts/game-ui-types.ts';
export type { GameUiState } from './contracts/game-ui-types.ts';
export type { GameUiKind } from './contracts/game-ui-types.ts';
export { GAME_UI_KINDS } from './contracts/game-ui-types.ts';
export type { GameUiShape } from './contracts/game-ui-types.ts';
export { GAME_UI_SHAPES } from './contracts/game-ui-types.ts';
export type { GameUiSlot } from './contracts/game-ui-types.ts';
export type { GameUiCommand } from './contracts/game-ui-types.ts';
export const GAME_UI_DIRECTORY = '.canvas/game-ui';
export const GAME_UI_VERSION = 1;
export function gameUiHeight(frame: GameUiFrame) {
  return 42 + (frame.width * frame.viewportHeight) / frame.viewportWidth;
}
