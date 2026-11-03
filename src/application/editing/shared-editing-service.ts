import type { SharedEditingProject } from '../ports/shared-editing-project.ts';
import type { SharedWorkspaceReader } from './shared-workspace-reader.ts';
import type { CommandName, CommandInput } from '../../contracts/commands.ts';
import type {
  SetDocumentCollapsedInput,
  SaveDocumentInput,
} from '../../contracts/documents.ts';
import type { Snapshot } from '../../contracts/project.ts';
import type { EditJournal } from '../../edit-journal.ts';
import { COMMAND_LABELS } from '../../contracts/commands.ts';

type Ports = {
  inspectNames?: (
    files: Snapshot,
    scope: string,
  ) => import('../../contracts/document-names.ts').FileNamePlan;
  project: SharedEditingProject;
  reader: SharedWorkspaceReader;
  journal: Pick<EditJournal, 'push' | 'peek' | 'finish'>;
  assertCurrent(): void;
  assertAllowed(channel: CommandName, input: unknown): Promise<void>;
  assertUnlocked(paths: string[]): void;
  sync(files: Snapshot): Promise<void>;
  trash(before: Snapshot, after: Snapshot): Promise<void>;
  changed(): void;
};

/** Shared/offline commands keep transport authorization and receipts in the authenticated client. */
export class SharedEditingService {
  readonly reader: SharedWorkspaceReader;
  private ports: Ports;
  constructor(ports: Ports) {
    this.ports = ports;
    this.reader = ports.reader;
  }
  async execute<K extends CommandName>(
    channel: K,
    input: CommandInput<K>,
  ): Promise<unknown> {
    const p = this.ports;
    p.assertCurrent();
    await p.assertAllowed(channel, input);
    p.assertCurrent();
    const before = p.project.read().files;
    const receipt = await p.project.command(channel, input);
    p.assertCurrent();
    const after = p.project.read().files;
    if (
      [
        'results:move',
        'results:organize',
        'documents:rename',
        'preview:rename',
        'files:unify-names',
      ].includes(channel)
    )
      await p.sync(after);
    if (
      channel === 'documents:delete' ||
      channel === 'documents:delete-many' ||
      channel === 'canvas:batch'
    )
      await p.trash(before, after);
    p.assertCurrent();
    if (receipt.historyId && channel !== 'tasks:create')
      p.journal.push({ id: receipt.historyId, label: COMMAND_LABELS[channel] });
    p.changed();
    if (channel === 'documents:save')
      return this.reader.document((input as SaveDocumentInput).relativePath);
    if (channel === 'documents:rename') {
      const change =
        receipt.result as import('../../contracts/document-names.ts').DocumentNameChange;
      return {
        document: this.reader.document(change.to),
        change,
        affectedPaths: Object.keys({ ...before, ...after }).filter(
          (path) => before[path] !== after[path],
        ),
      };
    }
    if (channel === 'preview:rename') {
      const change =
        receipt.result as import('../../contracts/document-names.ts').DocumentNameChange;
      return {
        preview: this.reader
          .previews()
          .find((p) => p.relativePath === change.to),
        change,
        affectedPaths: Object.keys({ ...before, ...after }).filter(
          (path) => before[path] !== after[path],
        ),
      };
    }
    if (channel === 'drawings:apply') return this.reader.drawings();
    if (channel === 'game-ui:apply') return this.reader.gameUi();
    return receipt.result;
  }
  async changeHistory(direction: 'undo' | 'redo') {
    const p = this.ports;
    p.assertCurrent();
    const item = p.journal.peek(direction);
    await p.project.changeHistory(item.id, direction);
    p.journal.finish(direction, item.id);
    p.assertCurrent();
    p.changed();
  }
  inspectNames(scope: string) {
    this.ports.assertCurrent();
    if (!this.ports.inspectNames)
      throw Error('파일 이름 통일을 사용할 수 없습니다.');
    return this.ports.inspectNames(this.ports.project.read().files, scope);
  }
  setCollapsed(input: SetDocumentCollapsedInput) {
    this.ports.assertCurrent();
    this.ports.assertUnlocked([input.relativePath]);
    this.reader.setCollapsed(input.relativePath, input.collapsed);
    this.ports.changed();
  }
}
