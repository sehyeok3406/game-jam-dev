import type { Snapshot } from '../../contracts/project.ts';
import type { LocalProjectRepository } from '../ports/local-project-repository.ts';
import type { EditJournal } from '../../edit-journal.ts';
import type { CommandEnvironment } from '../../core/editing/environment.ts';
import type { CommandPublisher, CommandPlan } from './command-service.ts';
import type { CommandName } from '../../contracts/commands.ts';
import { COMMAND_LABELS } from '../../contracts/commands.ts';

/** The history repository and journal are captured before the originating edit awaits. */
export class UserEditRecorder {
  private repository: Pick<LocalProjectRepository, 'saveHistory'>;
  private journal: Pick<EditJournal, 'push'>;
  private environment: CommandEnvironment;
  constructor(
    repository: Pick<LocalProjectRepository, 'saveHistory'>,
    journal: Pick<EditJournal, 'push'>,
    environment: CommandEnvironment,
  ) {
    this.repository = repository;
    this.journal = journal;
    this.environment = environment;
  }
  async record(before: Snapshot, after: Snapshot, label: string) {
    const touched = Object.keys({ ...before, ...after }).filter(
      (relative) => before[relative] !== after[relative],
    );
    if (!touched.length) return;
    const id = this.environment.id();
    await this.repository.saveHistory(before, after, {
      id,
      label,
      kind: 'user',
      status: 'completed',
      createdAt: this.environment.now(),
      finishedAt: this.environment.now(),
    });
    if (
      label !== 'AI 작업 요청' &&
      !(
        label === '문서 최소화·펼치기' &&
        touched.every((relative) => relative.startsWith('.ai/tasks/'))
      )
    )
      this.journal.push({ id, label });
  }
}

const MANUAL_LABELS: Partial<Record<CommandName, string>> = {
  'sections:rename': COMMAND_LABELS['sections:rename'],
  'documents:delete-many': COMMAND_LABELS['documents:delete-many'],
  'documents:set-color': COMMAND_LABELS['documents:set-color'],
  'layouts:update': COMMAND_LABELS['layouts:update'],
};
/** These four commands own their acknowledgement; the legacy mutation wrapper does not record them again. */
export class RecordedCommandPublisher implements CommandPublisher {
  private publisher: CommandPublisher;
  private recorder: UserEditRecorder;
  private changed: () => void;
  constructor(
    publisher: CommandPublisher,
    recorder: UserEditRecorder,
    changed: () => void,
  ) {
    this.publisher = publisher;
    this.recorder = recorder;
    this.changed = changed;
  }
  async publish(channel: CommandName, plan: CommandPlan) {
    await this.publisher.publish(channel, plan);
    const label = MANUAL_LABELS[channel];
    if (label) await this.recorder.record(plan.before, plan.files, label);
    if (channel === 'documents:set-color' || channel === 'layouts:update')
      this.changed();
  }
}
