import type { LocalProjectRepository } from '../ports/local-project-repository.ts';
import type { Snapshot } from '../../contracts/project.ts';
import type { EditJournal } from '../../edit-journal.ts';
import type { CommandEnvironment } from '../../core/editing/environment.ts';
import { invertEdit } from '../../edit-journal.ts';
import { checkSnapshot } from '../../collaboration-model.ts';
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
    const entry = (await this.repository.history()).find(
      (entry) => entry.id === item.id,
    );
    if (!entry || entry.kind !== 'user')
      throw Error('되돌릴 기록을 찾을 수 없습니다.');
    const before: Snapshot = {},
      after: Snapshot = {};
    for (const file of entry.files) {
      const left = await this.repository.readHistory(
        item.id,
        file.relativePath,
        'before',
      );
      const right = await this.repository.readHistory(
        item.id,
        file.relativePath,
        'after',
      );
      if (left !== null) before[file.relativePath] = left;
      if (right !== null) after[file.relativePath] = right;
    }
    const current = await this.repository.capture();
    const next = invertEdit(current, before, after, direction);
    checkSnapshot(next);
    await this.publisher.publish(
      current,
      next,
      entry.files.map((file) => file.relativePath),
    );
    await this.repository.saveHistory(current, next, {
      id: this.environment.id(),
      label: `${direction === 'undo' ? '실행 취소' : '다시 실행'} · ${item.label}`,
      kind: 'user',
      status: 'completed',
      createdAt: this.environment.now(),
    });
    this.journal.finish(direction, item.id);
  }
}
