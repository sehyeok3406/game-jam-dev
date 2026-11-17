import type { LocalProjectRepository } from '../ports/local-project-repository.ts';
import type { Snapshot } from '../../contracts/project.ts';
import type { EditJournal } from '../../edit-journal.ts';
import type { CommandEnvironment } from '../../core/editing/environment.ts';
import { isDrawingPath } from '../../core/editing/drawing-path.ts';
import { invertEdit } from '../../edit-journal.ts';
import { checkSnapshot } from '../../collaboration-model.ts';

export function localHistoryInverse(
  current: Snapshot,
  before: Snapshot,
  after: Snapshot,
  direction: 'undo' | 'redo',
) {
  const next = invertEdit(current, before, after, direction);
  checkSnapshot(next, true);
  return next;
}

export interface EditHistoryPublisher {
  publish(before: Snapshot, after: Snapshot, paths: string[]): Promise<void>;
}
export class LocalEditHistoryService {
  private repository: LocalProjectRepository;
  private journal: EditJournal;
  private publisher: EditHistoryPublisher;
  private environment: CommandEnvironment;
  constructor(
    repository: LocalProjectRepository,
    journal: EditJournal,
    publisher: EditHistoryPublisher,
    environment: CommandEnvironment,
  ) {
    this.repository = repository;
    this.journal = journal;
    this.publisher = publisher;
    this.environment = environment;
  }
  async change(direction: 'undo' | 'redo') {
    const item = this.journal.peek(direction);
    const record = await this.repository.readEditHistory(item.id);
    if (!record) throw Error('되돌릴 기록을 찾을 수 없습니다.');
    const { entry, before, after } = record;
    const paths = entry.files.map((file) => file.relativePath);
    const drawingOnly = paths.length > 0 && paths.every(isDrawingPath);
    const current = await (drawingOnly && this.repository.captureCanvas
      ? this.repository.captureCanvas('drawings')
      : this.repository.capture());
    const next = localHistoryInverse(current, before, after, direction);
    await this.publisher.publish(current, next, paths);
    await this.repository.saveHistory(current, next, {
      id: this.environment.id(),
      label: `${direction === 'undo' ? '실행 취소' : '다시 실행'} · ${item.label}`,
      kind: 'user',
      status: 'completed',
      createdAt: this.environment.now(),
    });
    this.journal.finish(direction, item.id);
    return { before: current, after: next, paths, drawingOnly };
  }
}
