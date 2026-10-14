export const GAME_UI_DIRECTORY = '.canvas/game-ui';
export const GAME_UI_VERSION = 1;
export const GAME_UI_KINDS = {
  health: ['체력', '현재 체력과 최대 체력을 표시합니다.'],
  mana: ['마나', '현재 마나와 최대 마나를 표시합니다.'],
  stamina: ['스태미나', '사용 가능한 스태미나를 표시합니다.'],
  experience: ['경험치', '성장 진행도를 표시합니다.'],
  skills: ['스킬 바', '스킬·단축키·쿨다운 상태를 표시합니다.'],
  items: ['아이템 바', '아이템·수량·선택 상태를 표시합니다.'],
  button: ['버튼', '사용자가 선택할 동작을 표시합니다.'],
  panel: ['패널', '관련 UI를 담는 영역을 표시합니다.'],
  text: ['텍스트', '안내와 정보를 표시합니다.'],
  image: ['이미지 자리', '초상화·미니맵·아이콘의 위치를 표시합니다.'],
} as const;
export type GameUiKind = keyof typeof GAME_UI_KINDS;
export const GAME_UI_SHAPES = {
  rectangle: '직사각형',
  rounded: '둥근 사각형',
  circle: '원형',
  ring: '원형 링',
  triangle: '삼각형',
} as const;
export type GameUiShape = keyof typeof GAME_UI_SHAPES;
export type GameUiSlot = {
  id: string;
  label: string;
  quantity: number;
  cooldown: number;
  cooldownTotal?: number;
  cooldownRemaining?: number;
  disabled?: boolean;
};
export type GameUiStyle = {
  backgroundColor: string;
  backgroundOpacity: number;
  borderColor: string;
  borderOpacity: number;
  borderWidth: number;
  borderStyle: 'solid' | 'dashed' | 'dotted';
  borderPosition: 'inside' | 'center' | 'outside';
  cornerRadius: number;
  cornerRadii: [number, number, number, number] | null;
  fillColor: string;
  fillOpacity: number;
  textColor: string;
  textOpacity: number;
  fontSize: number;
  textAlign: 'left' | 'center' | 'right';
  textVisible: boolean;
  opacity: number;
};
export type GameUiState =
  | 'normal'
  | 'hover'
  | 'pressed'
  | 'disabled'
  | 'selected';
export type GameUiDetails = Partial<GameUiStyle> & {
  rotation?: number;
  minimum?: number;
  step?: number;
  decimals?: number;
  valueFormat?: 'fraction' | 'value' | 'percent' | 'none';
  fillDirection?:
    | 'right'
    | 'left'
    | 'up'
    | 'down'
    | 'center-x'
    | 'center-y'
    | 'radial';
  radialStart?: number;
  radialSweep?: number;
  clockwise?: boolean;
  ringWidth?: number;
  segments?: number;
  segmentGap?: number;
  segmentSnap?: boolean;
  thresholds?: { below: number; color: string }[];
  state?: GameUiState;
  stateStyles?: Partial<Record<GameUiState, Partial<GameUiStyle>>>;
  cooldownDirection?: 'down' | 'radial';
  cooldownColor?: string;
  cooldownOpacity?: number;
  cooldownText?: boolean;
  transitionDuration?: number;
  deltaColor?: string;
  deltaDuration?: number;
};
export type GameUiItem = GameUiDetails & {
  id: string;
  generation: string;
  kind: GameUiKind;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  shape: GameUiShape;
  color: string;
  text: string;
  value: number;
  maximum: number;
  count: number;
  columns: number;
  gap: number;
  selectedSlot: string | null;
  slots: GameUiSlot[];
  groupId: string | null;
  locked: boolean;
};
export type GameUiFrame = {
  version: 1;
  id: string;
  generation: string;
  canvasId: string;
  title: string;
  x: number;
  y: number;
  width: number;
  viewportWidth: number;
  viewportHeight: number;
  items: GameUiItem[];
  descriptionPath: string | null;
};
export type GameUiCommand = {
  scope?: string;
  requestId?: string;
  id: string;
  generation: string;
  action:
    | 'create'
    | 'frame'
    | 'add'
    | 'patch'
    | 'remove'
    | 'delete'
    | 'describe'
    | 'move';
  frame?: GameUiFrame;
  changes?: Partial<
    Pick<
      GameUiFrame,
      'title' | 'x' | 'y' | 'width' | 'viewportWidth' | 'viewportHeight'
    >
  >;
  expected?: GameUiCommand['changes'];
  items?: GameUiItem[];
  patches?: {
    id: string;
    generation: string;
    changes: Partial<GameUiItem>;
    expected: Partial<GameUiItem>;
  }[];
  targets?: { id: string; generation: string }[];
  targetCanvasId?: string;
};
export function gameUiHeight(frame: GameUiFrame) {
  return 42 + (frame.width * frame.viewportHeight) / frame.viewportWidth;
}
