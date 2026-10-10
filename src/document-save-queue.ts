import { editorDraftMatches, type EditorDraft } from './editor-ux.ts';
import type { CanvasDocument, SaveDocumentInput } from './shared.ts';

export type DocumentSaveRequest = EditorDraft & {
  scope: string;
  key: string;
  relativePath: string;
  documentId: string;
  sequence: number;
  sessionId?: string;
  base: EditorDraft;
};
export type DocumentSavePhase =
  | 'queued'
  | 'saving'
  | 'saved'
  | 'offline'
  | 'conflict'
  | 'failed'
  | 'discarded';
export type DocumentSaveState = {
  scope: string;
  key: string;
  documentId: string;
  relativePath: string;
  sequence: number;
  savedSequence: number;
  phase: DocumentSavePhase;
  latest: EditorDraft;
  saved: EditorDraft;
  document?: CanvasDocument;
  error?: string;
};
export type DocumentSaveRecord = {
  request: DocumentSaveRequest;
  base: EditorDraft;
  savedSequence: number;
  attempt?: EditorDraft & { sequence: number };
  adoptBase?: EditorDraft;
  phase: DocumentSavePhase;
  error?: string;
};
export type DocumentSaveStorage = {
  load: () => Promise<DocumentSaveRecord[]>;
  put: (record: DocumentSaveRecord) => Promise<void>;
  remove: (scope: string, key: string) => Promise<void>;
  flush: (scope?: string, key?: string) => Promise<void>;
};
export type DocumentSaveAdapter = {
  scope: string;
  isCurrent: () => boolean;
  canSend: () => boolean;
  read: (relativePath: string) => Promise<CanvasDocument | null>;
  write: (input: SaveDocumentInput) => Promise<CanvasDocument>;
};

export function validateDocumentSave(request: DocumentSaveRequest) {
  if (
    !request ||
    !Number.isSafeInteger(request.sequence) ||
    request.sequence < 1 ||
    [request.scope, request.key, request.documentId, request.relativePath].some(
      (value) => typeof value !== 'string' || !value || value.length > 2000,
    ) ||
    typeof request.title !== 'string' ||
    typeof request.body !== 'string' ||
    request.body.length > 2_000_000 ||
    typeof request.base?.title !== 'string' ||
    typeof request.base?.body !== 'string'
  )
    throw new Error('저장할 문서 정보가 올바르지 않습니다.');
}
const identity = (scope: string, key: string) => JSON.stringify([scope, key]);
const draft = (value: EditorDraft): EditorDraft => ({
  title: value.title,
  body: value.body,
});

/** Durable latest-snapshot queue. Only unsent snapshots are compacted; an attempt is immutable. */
export class DocumentSaveQueue {
  private entries = new Map<string, DocumentSaveRecord>();
  private documents = new Map<string, CanvasDocument>();
  private running = new Map<string, Promise<void>>();
  private ready: Promise<void>;
  private adapter?: DocumentSaveAdapter;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private storage: DocumentSaveStorage;
  private publish: (state: DocumentSaveState) => void;
  constructor(
    storage: DocumentSaveStorage,
    publish: (state: DocumentSaveState) => void = () => {},
  ) {
    this.storage = storage;
    this.publish = publish;
    this.ready = storage.load().then((records) => {
      for (const record of records) {
        validateDocumentSave(record.request);
        if (record.phase === 'saving') record.phase = 'queued';
        this.entries.set(
          identity(record.request.scope, record.request.key),
          record,
        );
      }
    });
  }
  private state(entry: DocumentSaveRecord): DocumentSaveState {
    const r = entry.request;
    return {
      scope: r.scope,
      key: r.key,
      documentId: r.documentId,
      relativePath: r.relativePath,
      sequence: r.sequence,
      savedSequence: entry.savedSequence,
      phase: entry.phase,
      latest: draft(r),
      saved: draft(entry.base),
      document:
        entry.phase === 'saved'
          ? this.documents.get(identity(r.scope, r.key))
          : undefined,
      error: entry.error,
    };
  }
  private emit(entry: DocumentSaveRecord, document?: CanvasDocument) {
    this.publish({ ...this.state(entry), ...(document ? { document } : {}) });
  }
  async activate(adapter: DocumentSaveAdapter) {
    await this.ready;
    this.adapter = adapter;
    this.wake();
    return this.list(adapter.scope);
  }
  async list(scope: string) {
    await this.ready;
    return [...this.entries.values()]
      .filter((e) => e.request.scope === scope)
      .map((e) => this.state(e));
  }
  async enqueue(request: DocumentSaveRequest) {
    validateDocumentSave(request);
    await this.ready;
    if (!this.adapter?.isCurrent() || this.adapter.scope !== request.scope)
      throw new Error('프로젝트가 변경되었습니다. 초안은 이 PC에 보관됩니다.');
    const key = identity(request.scope, request.key);
    let entry = this.entries.get(key);
    if (
      entry &&
      (entry.request.documentId !== request.documentId ||
        entry.request.relativePath !== request.relativePath)
    )
      throw new Error('저장할 문서 식별자가 변경되었습니다.');
    if (entry && request.sequence <= entry.request.sequence) {
      if (
        request.sequence === entry.request.sequence &&
        !editorDraftMatches(request, entry.request)
      )
        throw new Error('같은 변경 번호에 서로 다른 내용이 있습니다.');
      try {
        await this.storage.flush(request.scope, request.key);
      } catch {
        // A previous disk failure must be retryable without requiring another
        // keystroke or a different sequence. Re-persist the latest known draft.
        await this.storage.put(structuredClone(entry));
        this.emit(entry);
        this.kick(key);
      }
      return this.state(entry);
    }
    if (!entry) {
      entry = {
        request: structuredClone(request),
        base: draft(request.base),
        savedSequence: 0,
        phase: 'queued',
      };
      this.entries.set(key, entry);
    } else {
      // A new edit session may have explicitly adopted newer server text, but
      // pending/conflicting work must never silently rebase onto that text.
      if (
        entry.phase === 'saved' &&
        entry.request.sessionId !== request.sessionId
      )
        entry.adoptBase = draft(request.base);
      entry.request = structuredClone(request);
      if (!['conflict', 'failed'].includes(entry.phase))
        entry.phase = this.running.has(key) ? 'saving' : 'queued';
    }
    await this.storage.put(structuredClone(entry));
    this.emit(entry);
    this.kick(key);
    return this.state(entry);
  }
  wake() {
    if (this.disposed) return;
    void this.ready
      .then(() => {
        for (const key of this.entries.keys()) this.kick(key);
      })
      .catch(() => undefined);
  }
  private later() {
    if (this.timer || this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.wake();
    }, 2000);
    this.timer.unref?.();
  }
  private kick(key: string) {
    const entry = this.entries.get(key),
      adapter = this.adapter;
    if (
      this.disposed ||
      !entry ||
      !adapter ||
      !adapter.isCurrent() ||
      adapter.scope !== entry.request.scope ||
      this.running.has(key) ||
      ['saved', 'conflict', 'failed'].includes(entry.phase)
    )
      return;
    const operation = Promise.resolve()
      .then(async () => {
        while (
          adapter.isCurrent() &&
          this.adapter === adapter &&
          entry.savedSequence < entry.request.sequence
        ) {
          if (!adapter.canSend()) {
            if (entry.phase !== 'offline') {
              entry.phase = 'offline';
              this.emit(entry);
            }
            this.later();
            return;
          }
          try {
            await this.storage.flush(entry.request.scope, entry.request.key);
            const current = await adapter.read(entry.request.relativePath);
            if (!adapter.isCurrent() || this.adapter !== adapter) return;
            if (!current || current.id !== entry.request.documentId)
              throw new SaveConflict(
                '문서가 이동되거나 삭제되었습니다. 초안은 이 PC에 보관됩니다.',
              );
            if (entry.adoptBase && editorDraftMatches(current, entry.adoptBase))
              entry.base = draft(entry.adoptBase);
            delete entry.adoptBase;
            // After a crash the previous attempt may already have reached the
            // server. Reconcile that exact attempt before sending newer text.
            if (entry.attempt && editorDraftMatches(current, entry.attempt)) {
              entry.base = draft(entry.attempt);
              entry.savedSequence = Math.max(
                entry.savedSequence,
                entry.attempt.sequence,
              );
              delete entry.attempt;
            }
            if (editorDraftMatches(current, entry.request)) {
              entry.base = draft(entry.request);
              entry.savedSequence = entry.request.sequence;
              this.documents.set(key, current);
            } else {
              if (!editorDraftMatches(current, entry.base))
                throw new SaveConflict(
                  '문서가 다른 곳에서 변경되었습니다. 초안을 유지하고 최신 내용을 확인해주세요.',
                );
              const sent = {
                ...draft(entry.request),
                sequence: entry.request.sequence,
              };
              entry.attempt = sent;
              entry.phase = 'saving';
              delete entry.error;
              await this.storage.put(structuredClone(entry));
              if (!adapter.isCurrent() || this.adapter !== adapter) return;
              this.emit(entry);
              const confirmed = await adapter.write({
                relativePath: current.relativePath,
                objectId: current.id,
                revision: current.revision,
                contentRevision: current.contentRevision,
                structureRevision: current.structureRevision,
                expectedTitle: current.title,
                expectedBody: current.body,
                title: sent.title,
                body: sent.body,
              });
              if (!editorDraftMatches(confirmed, sent))
                throw new SaveConflict(
                  '저장된 내용이 변경되었습니다. 초안은 이 PC에 보관됩니다.',
                );
              entry.base = draft(sent);
              entry.savedSequence = sent.sequence;
              delete entry.attempt;
              this.documents.set(key, confirmed);
            }
            entry.phase =
              entry.savedSequence >= entry.request.sequence
                ? 'saved'
                : 'queued';
            delete entry.error;
            await this.storage.put(structuredClone(entry));
            this.emit(entry, this.documents.get(key));
          } catch (error) {
            entry.error =
              error instanceof Error ? error.message : String(error);
            entry.phase =
              error instanceof SaveConflict ||
              /문서.*변경|객체.*변경|충돌|revision conflict/i.test(entry.error)
                ? 'conflict'
                : !adapter.canSend() ||
                    /ECONN|ETIMEDOUT|fetch failed|network|timeout|연결|응답.*유실/i.test(
                      entry.error,
                    )
                  ? 'offline'
                  : 'failed';
            await this.storage
              .put(structuredClone(entry))
              .catch(() => undefined);
            this.emit(entry);
            if (entry.phase === 'offline') this.later();
            return;
          }
        }
      })
      .finally(() => {
        this.running.delete(key);
        // Activation can change while an old read/write is finishing.
        if (this.adapter !== adapter) this.kick(key);
      });
    this.running.set(key, operation);
    void operation.catch(() => undefined);
  }
  async flush(scope: string, key?: string) {
    await this.ready;
    if (!this.adapter?.isCurrent() || this.adapter.scope !== scope)
      throw new Error('프로젝트가 변경되었습니다.');
    const entries = [...this.entries.entries()].filter(
      ([, e]) => e.request.scope === scope && (!key || e.request.key === key),
    );
    for (const [id, entry] of entries) {
      if (entry.phase === 'failed') {
        entry.phase = 'queued';
        delete entry.error;
      }
      this.kick(id);
    }
    await Promise.all(
      entries.map(async ([id]) => {
        let operation = this.running.get(id);
        while (operation) {
          await operation;
          // Returning to a project may activate a new worker while an old read
          // finishes. Flush must wait for the replacement worker as well.
          operation = this.running.get(id);
        }
      }),
    );
    await Promise.all(
      entries.map(([, e]) =>
        this.storage.flush(e.request.scope, e.request.key),
      ),
    );
    const states = entries.map(([, e]) => this.state(e));
    const blocked = states.find(
      (s) => s.phase === 'conflict' || s.phase === 'failed',
    );
    if (blocked)
      throw new Error(
        blocked.error || '초안은 보관했지만 문서를 저장하지 못했습니다.',
      );
    return states;
  }
  async discard(scope: string, key: string, sequence: number) {
    await this.ready;
    const id = identity(scope, key),
      entry = this.entries.get(id);
    if (!entry) return;
    if (this.running.has(id) || entry.request.sequence !== sequence)
      throw new Error('저장이 진행 중이거나 초안이 변경되었습니다.');
    await this.storage.remove(scope, key);
    this.entries.delete(id);
    this.documents.delete(id);
    this.publish({ ...this.state(entry), phase: 'discarded' });
  }
  hasPending() {
    return [...this.entries.values()].some(
      (e) => e.savedSequence < e.request.sequence,
    );
  }
  async checkpoint() {
    await this.ready;
    await this.storage.flush();
  }
  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
class SaveConflict extends Error {}
