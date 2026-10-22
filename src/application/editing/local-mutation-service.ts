import type { LocalProjectRepository } from '../ports/local-project-repository.ts';
import type { Snapshot } from '../../contracts/project.ts';
import { initializeWorkflows } from '../../document-workflow.ts';

export const LOCAL_MUTATION_LABELS: Record<string, string> = {
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
  'files:import': '파일 불러오기',
  'clipboard:canvas-paste': '이미지 붙여넣기',
  'documents:create-idea': '메모 추가',
  'documents:save': '문서 저장',
  'documents:set-collapsed': '문서 최소화·펼치기',
  'documents:delete': '문서 삭제',
  'documents:duplicate': '문서 복사',
  'sections:create': '섹션 생성',
  'documents:update-layout': '문서 배치 변경',
  'sections:update-layout': '섹션 배치 변경',
  'sections:delete': '섹션 해제·삭제',
  'sections:move-document': '섹션 소속 변경',
  'tasks:create': 'AI 작업 요청',
};
type Ports = {
  project: Pick<LocalProjectRepository, 'capture' | 'apply'>;
  assertCurrent(): void;
  record(before: Snapshot, after: Snapshot, label: string): Promise<void>;
  changed(): void;
};
/** Legacy local handlers keep partial capture and their own specialized writes. */
export class LocalMutationService {
  private ports: Ports;
  constructor(ports: Ports) {
    this.ports = ports;
  }
  async execute<T>(
    channel: string,
    args: unknown[],
    operation: () => Promise<T>,
  ): Promise<T> {
    const p = this.ports;
    p.assertCurrent();
    // Native clipboard import acknowledges its own history once, after files are persisted.
    const label =
      channel === 'clipboard:canvas-paste'
        ? undefined
        : LOCAL_MUTATION_LABELS[channel];
    const scopedPath = [
      'documents:save',
      'documents:update-layout',
      'documents:set-collapsed',
      'documents:set-color',
      'sections:rename',
    ].includes(channel)
      ? (args[0] as { relativePath?: string })?.relativePath
      : undefined;
    const capture = () =>
      p.project.capture(scopedPath?.endsWith('.md') ? [scopedPath] : undefined);
    const before = label ? await capture() : null;
    p.assertCurrent();
    const result = await operation();
    p.assertCurrent();
    if (before) {
      let after = await capture();
      p.assertCurrent();
      const initialized = [
        'documents:create-idea',
        'documents:duplicate',
        'files:import',
        'clipboard:canvas-paste',
        'tasks:create',
      ].includes(channel)
        ? initializeWorkflows(before, after)
        : after;
      const workflowUpdates = Object.fromEntries(
        Object.entries(initialized).filter(
          ([path, raw]) => raw !== after[path],
        ),
      );
      if (Object.keys(workflowUpdates).length) {
        await p.project.apply(after, workflowUpdates);
        p.assertCurrent();
        after = initialized;
      }
      if (
        Object.keys({ ...before, ...after }).some(
          (relative) => before[relative] !== after[relative],
        )
      ) {
        await p.record(before, after, label!);
        p.assertCurrent();
      }
    }
    p.changed();
    return result;
  }
}
