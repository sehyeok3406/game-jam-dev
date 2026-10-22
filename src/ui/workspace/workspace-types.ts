import type { AiQueueTask } from '../../ai-task-queue.ts';
import type { GameUiCanvasNode } from '../../features/game-ui/GameUiNode';
import type { KanbanCanvasNode } from '../../features/kanban/KanbanCanvasNode';
import { previewLabel } from '../../preview-output.ts';
import type {
  AiProviderId,
  CanvasDocument,
  CanvasSection,
  CodexRunEvent,
  PreviewResult,
} from '../../shared.ts';
import type { SectionCanvasNode } from '../canvas/SectionCard';
import type { DeletionItem } from '../canvas/selection-plan.ts';
import type { DocumentCanvasNode } from '../documents/DocumentCard';
import type { DrawingCanvasNode } from '../drawing/DrawingNode';
import type { PreviewCanvasNode } from '../preview/PreviewCard';
export type Theme = 'dark' | 'light';

export type ContextMenuState = {
  screenX: number;
  screenY: number;
  flowX: number;
  flowY: number;
};

export type DocumentContextMenuState = {
  screenX: number;
  screenY: number;
  document: CanvasDocument;
};

export type SectionContextMenuState = {
  screenX: number;
  screenY: number;
  section: CanvasSection;
};

export type PreviewContextMenuState = {
  screenX: number;
  screenY: number;
  preview: PreviewResult;
};

export type CodexRunView = {
  project: string;
  fileLock?: CodexRunEvent['fileLock'];
  runId: string;
  taskPath: string;
  status: CodexRunEvent['status'];
  events: CodexRunEvent[];
  providerId: AiProviderId;
  modelId: string | null;
  reasoningEffort?: import('../../shared').AiReasoningEffort | null;
};

export const CODEX_STATUS_LABELS: Record<CodexRunEvent['status'], string> = {
  queued: '예약됨',
  validating: '결과 확인 중',
  starting: '시작 중',
  running: '실행 중',
  completed: '완료',
  failed: '실패',
  cancelled: '취소됨',
};
export const EMPTY_AI_QUEUE: AiQueueTask[] = [];

export type CanvasNode =
  | DocumentCanvasNode
  | PreviewCanvasNode
  | SectionCanvasNode
  | DrawingCanvasNode
  | KanbanCanvasNode
  | GameUiCanvasNode;

export function sameIds(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

export const sectionNodeId = (id: string) => `section:${id}`;
export const previewNodeId = (relative: string) => `preview:${relative}`;
export const previewDeletionItem = (preview: PreviewResult): DeletionItem => ({
  id: previewNodeId(preview.relativePath),
  title: preview.title || previewLabel(preview.relativePath),
  relativePath: preview.relativePath,
  revision: preview.revision,
});

export type CanvasTool = 'select' | 'hand' | 'note' | 'drawing';
