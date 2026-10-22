import type { CanvasDocument } from '../../contracts/documents';
import type { DocumentSaveState } from '../../contracts/document-save-queue';

export function pendingDocument(
  document: CanvasDocument,
  state?: DocumentSaveState,
) {
  return state &&
    state.savedSequence < state.sequence &&
    ['queued', 'saving', 'offline'].includes(state.phase)
    ? { ...document, title: state.latest.title, body: state.latest.body }
    : document;
}

export const TYPE_LABELS: Record<CanvasDocument['type'], string> = {
  reference: '참고 문서',
  image: '이미지',
  idea: '아이디어',
  system: '정리 문서',
  overview: '개요',
  question: '미정 사항',
  'ai-task': 'AI 작업',
};

export const statusLabel = (status: string) =>
  (
    ({
      raw: '메모',
      draft: '초안',
      pending: '대기',
      running: '실행 중',
      starting: '준비 중',
      validating: '검증 중',
      completed: '완료',
      failed: '실패',
      cancelled: '중지',
      active: '사용 중',
    }) as Record<string, string>
  )[status] ?? status;
