import type { EditorApi } from './app-api.ts';
import type { CanvasDocument } from './documents.ts';
import type { CanvasSection, DeleteSectionResult } from './canvas.ts';
import type { ImportBatchInput } from './documents.ts';
import type { DrawingCommand } from './drawing-types.ts';
import type { GameUiCommand, GameUiFrame } from './game-ui-types.ts';
import type { ResultMove } from './results.ts';

export type CommandSpec<I, O = void> = { input: I; output: O };
type Input<M extends keyof EditorApi> = EditorApi[M] extends (
  input: infer I,
) => unknown
  ? I
  : never;

/** Reducer outputs. IPC saveDocument still returns a fresh CanvasDocument. */
export type CommandMap = {
  'kanban:move-card': CommandSpec<Input<'moveKanbanCard'>>;
  'kanban:save-view': CommandSpec<Input<'saveKanbanView'>>;
  'files:set-status-property': CommandSpec<Input<'setFileStatusProperty'>>;
  'documents:set-workflow': CommandSpec<Input<'setDocumentWorkflow'>>;
  'document-statuses:save': CommandSpec<Input<'saveDocumentStatuses'>>;
  'drawings:apply': CommandSpec<DrawingCommand>;
  'game-ui:apply': CommandSpec<GameUiCommand, GameUiFrame[]>;
  'canvas:batch': CommandSpec<{ commands: BatchCommand[] }, BatchResult[]>;
  'canvases:change': CommandSpec<Input<'changeCanvasSheets'>>;
  'results:move': CommandSpec<Input<'moveResult'>, ResultMove[]>;
  'results:organize': CommandSpec<Record<string, never>, ResultMove[]>;
  'documents:set-color': CommandSpec<Input<'setDocumentColor'>>;
  'files:import-batch': CommandSpec<ImportBatchInput, CanvasDocument[]>;
  'documents:delete-many': CommandSpec<{
    documents: Input<'deleteDocument'>[];
  }>;
  'documents:create-idea': CommandSpec<Input<'createIdea'>, CanvasDocument>;
  'documents:save': CommandSpec<Input<'saveDocument'>>;
  'documents:delete': CommandSpec<Input<'deleteDocument'>>;
  'documents:duplicate': CommandSpec<
    Input<'duplicateDocuments'>,
    CanvasDocument[]
  >;
  'sections:create': CommandSpec<Input<'createSection'>, CanvasSection>;
  'sections:rename': CommandSpec<{
    relativePath: string;
    title: string;
    revision?: number;
  }>;
  'sections:delete': CommandSpec<Input<'deleteSection'>, DeleteSectionResult>;
  'sections:move-document': CommandSpec<Input<'moveDocumentToSection'>>;
  'documents:update-layout': CommandSpec<Input<'updateDocumentLayout'>>;
  'sections:update-layout': CommandSpec<Input<'updateSectionLayout'>>;
  'layouts:update': CommandSpec<{ updates: Input<'updateLayouts'> }>;
  'tasks:create': CommandSpec<Input<'createTask'>, CanvasDocument>;
};
export type CommandName = keyof CommandMap;
export type CommandInput<K extends CommandName> = CommandMap[K]['input'];
export type CommandOutput<K extends CommandName> = CommandMap[K]['output'];
type BatchName =
  | 'drawings:apply'
  | 'game-ui:apply'
  | 'layouts:update'
  | 'documents:duplicate'
  | 'documents:delete-many'
  | 'sections:delete'
  | 'canvases:change';
export type BatchCommand = {
  [K in BatchName]: { channel: K; input: CommandInput<K> };
}[BatchName];
export type BatchResult = CommandOutput<BatchName>;

export const COMMAND_LABELS = {
  'kanban:move-card': '칸반 카드 이동',
  'kanban:save-view': '칸반 보기 설정 변경',
  'files:set-status-property': '파일 상태 속성 변경',
  'documents:set-workflow': '문서 진행 상태 변경',
  'document-statuses:save': '문서 상태 설정 변경',
  'drawings:apply': '도형 · 그림 편집',
  'game-ui:apply': '게임 UI 편집',
  'canvas:batch': '선택 항목 함께 편집',
  'canvases:change': '캔버스 구성 변경',
  'results:move': 'HTML 결과물 폴더 이동',
  'results:organize': '기존 HTML 결과물 폴더 정리',
  'documents:set-color': '카드 배경색 변경',
  'files:import-batch': '파일 불러오기',
  'documents:delete-many': '선택 문서 삭제',
  'documents:create-idea': '메모 추가',
  'documents:save': '문서 수정',
  'documents:delete': '문서 삭제',
  'documents:duplicate': '문서 복사',
  'sections:create': '섹션 생성',
  'sections:rename': '섹션 이름 변경',
  'sections:delete': '섹션 해제·삭제',
  'sections:move-document': '섹션 소속 변경',
  'documents:update-layout': '문서 배치 변경',
  'sections:update-layout': '섹션 배치 변경',
  'layouts:update': '여러 항목 배치 변경',
  'tasks:create': 'AI 작업 요청',
} as const satisfies Record<CommandName, string>;

export function isCommandName(value: unknown): value is CommandName {
  return typeof value === 'string' && Object.hasOwn(COMMAND_LABELS, value);
}
