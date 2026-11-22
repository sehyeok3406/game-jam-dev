import type { CanvasDocument } from '../../contracts/documents.ts';
import type { DrawingCommand } from '../../contracts/drawing-types.ts';
import type { EditorDraft } from '../../contracts/drafts.ts';
import type { HistoryEntry } from '../../contracts/history.ts';
import type { Snapshot } from '../../contracts/project.ts';
import type { LocalProjectRepository } from '../ports/local-project-repository.ts';
import { isDrawingPath } from '../../core/editing/drawing-path.ts';
import { applyCommand, snapshotChanges } from './command-service.ts';

export type EditSnapshots = { before: Snapshot; after: Snapshot };
export type LocalDocumentPlan = EditSnapshots & {
  accept(): Promise<CanvasDocument[]>;
  fail(error: unknown): Promise<void>;
};
type Direction = 'undo' | 'redo';
type Ports = {
  repository: Pick<LocalProjectRepository, 'capture' | 'captureCanvas'>;
  preparePublication(
    before: Snapshot,
    after: Snapshot,
    entry: Omit<HistoryEntry, 'files'>,
  ): Promise<{
    apply(): Promise<void>;
    finish(): Promise<void>;
  }>;
  serial(work: () => Promise<void>): Promise<unknown>;
  planDocuments(): Promise<LocalDocumentPlan>;
  checkpointDocuments(): Promise<void>;
  pendingDocuments(): boolean;
  assertWritable(paths: string[]): void;
  readDraft(): Promise<EditorDraft | null>;
  writeDraft(draft: EditorDraft | null, sequence: number): Promise<void>;
  drawingEdit(before: Snapshot, after: Snapshot): EditSnapshots;
  invertDrawing(
    current: Snapshot,
    edit: EditSnapshots,
    direction: Direction,
  ): Snapshot;
  pushEdit(edit: EditSnapshots, drawingOnly: boolean): void;
  drawingPersistence(phase: 'pending' | 'draft' | 'saved'): void;
  published(edit: EditSnapshots, documents: CanvasDocument[]): void;
  failed(error: unknown): void;
  id(): string;
};

/** One open project owns its pending changes and both save clocks. */
export class LocalEditBatch {
  private ports: Ports;
  private drawingBase: Snapshot = {};
  private drawingChanges: Record<string, string | null> = {};
  private currentDrawings?: Snapshot;
  private idle?: ReturnType<typeof setTimeout>;
  private checkpoint?: ReturnType<typeof setTimeout>;
  private deadline = 0;
  private stopped = false;
  private recoveryBody: string | null = null;
  private unresolvedRecovery?: boolean;
  private recoverySequence = Date.now() * 1000;
  private requests = new Set<string>();
  private publication?: EditSnapshots & {
    finish(): Promise<void>;
    documents: LocalDocumentPlan;
    historySaved?: boolean;
  };

  constructor(ports: Ports) {
    this.ports = ports;
  }

  hasPendingDrawings() {
    return Object.keys(this.drawingChanges).length > 0;
  }

  touch() {
    if (this.stopped) return;
    this.deadline = Date.now() + 120_000;
    clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      void this.ports
        .serial(async () => {
          if (!this.stopped && Date.now() >= this.deadline) await this.flush();
        })
        .catch(this.ports.failed);
    }, 120_000);
    this.scheduleCheckpoint();
  }

  private scheduleCheckpoint() {
    if (
      this.checkpoint ||
      this.stopped ||
      !(
        this.ports.pendingDocuments() || Object.keys(this.drawingChanges).length
      )
    )
      return;
    this.checkpoint = setTimeout(() => {
      void this.ports
        .serial(() => this.backup())
        .catch(this.ports.failed)
        .finally(() => {
          this.checkpoint = undefined;
          this.scheduleCheckpoint();
        });
    }, 30_000);
  }

  dispose() {
    this.stopped = true;
    clearTimeout(this.idle);
    clearTimeout(this.checkpoint);
  }

  overlay(original: Snapshot): Snapshot {
    const result = { ...original };
    for (const [path, raw] of Object.entries(this.drawingChanges)) {
      if (raw === null) delete result[path];
      else result[path] = raw;
    }
    return result;
  }

  private async loadDrawings() {
    return (this.currentDrawings ??= this.overlay(
      await (this.ports.repository.captureCanvas?.('drawings') ??
        this.ports.repository.capture()),
    ));
  }

  private stage(before: Snapshot, after: Snapshot): boolean {
    const changes = snapshotChanges(before, after);
    const paths = Object.keys(changes);
    if (!paths.length) return false;
    this.ports.assertWritable(paths);
    for (const [path, raw] of Object.entries(changes)) {
      if (
        !Object.hasOwn(this.drawingChanges, path) &&
        before[path] !== undefined
      )
        this.drawingBase[path] = before[path];
      if (raw === (this.drawingBase[path] ?? null)) {
        delete this.drawingChanges[path];
        delete this.drawingBase[path];
      } else this.drawingChanges[path] = raw;
    }
    this.currentDrawings = after;
    this.ports.drawingPersistence(
      Object.keys(this.drawingChanges).length ? 'pending' : 'saved',
    );
    this.touch();
    return true;
  }

  async draw(command: DrawingCommand) {
    if (this.publication)
      throw Error('이전 저장을 완료한 뒤 다시 시도해주세요.');
    this.unresolvedRecovery ??= !!(await this.ports.readDraft());
    if (this.unresolvedRecovery)
      throw Error('보관된 그림 초안을 복구하거나 버린 뒤 다시 시도해주세요.');
    const before = await this.loadDrawings();
    if (command.requestId && this.requests.has(command.requestId))
      return before;
    const after = applyCommand(before, 'drawings:apply', command).files;
    if (this.stage(before, after))
      this.ports.pushEdit(this.ports.drawingEdit(before, after), true);
    if (command.requestId) {
      this.requests.add(command.requestId);
      if (this.requests.size > 1000)
        this.requests.delete(this.requests.values().next().value!);
    }
    return after;
  }

  async changeDrawing(edit: EditSnapshots, direction: Direction) {
    if (this.publication)
      throw Error('이전 저장을 완료한 뒤 다시 시도해주세요.');
    const before = await this.loadDrawings();
    this.stage(before, this.ports.invertDrawing(before, edit, direction));
    // An Undo that cancels the last pending write must not resurrect a checkpoint.
    if (this.recoveryBody !== null)
      await this.backup().catch(this.ports.failed);
  }

  invalidateDrawings() {
    this.currentDrawings = undefined;
  }

  async recover(action: 'restore' | 'discard') {
    const draft = await this.ports.readDraft();
    if (!draft) {
      this.unresolvedRecovery = false;
      return;
    }
    this.recoverySequence = Math.max(this.recoverySequence, draft.sequence);
    if (action === 'discard') {
      await this.ports.writeDraft(null, ++this.recoverySequence);
      this.unresolvedRecovery = false;
      return;
    }
    const stored = JSON.parse(draft.body) as {
      version: number;
      before: Snapshot;
      changes: Record<string, string | null>;
    };
    if (stored.version !== 1 || !stored.before || !stored.changes)
      throw Error('그림 초안 형식이 올바르지 않습니다.');
    const current = await this.loadDrawings();
    const next = { ...current };
    for (const [path, raw] of Object.entries(stored.changes)) {
      if (!isDrawingPath(path) || (raw !== null && typeof raw !== 'string'))
        throw Error('그림 초안 경로가 올바르지 않습니다.');
      if ((current[path] ?? null) === raw) continue;
      if (current[path] !== stored.before[path])
        throw Error(
          '그림 파일이 다른 곳에서 변경되었습니다. 기존 초안을 보관합니다.',
        );
      if (raw === null) delete next[path];
      else next[path] = raw;
    }
    this.recoveryBody = draft.body;
    this.unresolvedRecovery = false;
    const edit = this.ports.drawingEdit(current, next);
    if (this.stage(current, next)) this.ports.pushEdit(edit, true);
    await this.backup();
  }

  async backup() {
    if (this.stopped) return;
    const results = await Promise.allSettled([
      this.ports.checkpointDocuments(),
      this.backupDrawings(),
    ]);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
  }

  async backupDrawings() {
    const body = Object.keys(this.drawingChanges).length
      ? JSON.stringify({
          version: 1,
          before: this.drawingBase,
          changes: this.drawingChanges,
        })
      : null;
    if (body === this.recoveryBody) return;
    const sequence = ++this.recoverySequence;
    await this.ports.writeDraft(
      body === null ? null : { title: '그림 복구', body, sequence },
      sequence,
    );
    this.recoveryBody = body;
    if (body !== null) this.ports.drawingPersistence('draft');
  }

  async flush() {
    if (this.stopped) return;
    const p = this.ports;
    try {
      if (!this.publication) {
        const documents = await p.planDocuments();
        const before = { ...this.drawingBase, ...documents.before };
        const after = { ...this.overlay(this.drawingBase), ...documents.after };
        const changes = snapshotChanges(before, after);
        if (!Object.keys(changes).length) {
          await documents.accept();
          return;
        }
        const entry = {
          id: p.id(),
          label: '편집 내용 저장',
          kind: 'user' as const,
          status: 'completed' as const,
          createdAt: Date.now(),
        };
        try {
          p.assertWritable(Object.keys(changes));
          // Keep even edits younger than the normal 30-second checkpoint recoverable.
          await this.backup();
          const prepared = await p.preparePublication(before, after, entry);
          await prepared.apply();
          this.publication = {
            before,
            after,
            finish: prepared.finish,
            documents,
          };
        } catch (error) {
          await documents.fail(error);
          throw error;
        }
      }
      const commit = this.publication;
      if (!commit.historySaved) {
        await commit.finish();
        commit.historySaved = true;
      }
      const documents = await commit.documents.accept();
      if (
        Object.keys(
          snapshotChanges(commit.documents.before, commit.documents.after),
        ).length
      )
        p.pushEdit(commit.documents, false);
      this.publication = undefined;
      this.drawingBase = {};
      this.drawingChanges = {};
      p.drawingPersistence('saved');
      this.invalidateDrawings();
      p.published(commit, documents);
      await this.backup().catch(p.failed);
    } catch (error) {
      await this.backup().catch(p.failed);
      throw error;
    }
  }
}
