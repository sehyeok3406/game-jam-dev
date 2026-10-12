export const BUILTIN_CANVAS_FEATURES = [
  {
    id: 'builtin.kanban',
    name: '칸반 보드',
    description: '문서를 상태별로 모아 보고 진행 상태를 관리합니다.',
  },
] as const;
export type BuiltinCanvasFeatureId =
  (typeof BUILTIN_CANVAS_FEATURES)[number]['id'];
export type PluginPanelPage = 'plugins' | BuiltinCanvasFeatureId;
