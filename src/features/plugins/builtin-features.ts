export const BUILTIN_CANVAS_FEATURES = [
  {
    id: 'builtin.kanban',
    name: '칸반 보드',
    description: '문서를 상태별로 모아 보고 진행 상태를 관리합니다.',
  },
  {
    id: 'builtin.game-ui',
    name: '게임 UI 라이브러리',
    description: '게임 화면 틀 안에 체력·스킬·아이템·버튼을 배치합니다.',
  },
] as const;
export type BuiltinCanvasFeatureId =
  (typeof BUILTIN_CANVAS_FEATURES)[number]['id'];
export type PluginPanelPage = 'plugins' | BuiltinCanvasFeatureId;
