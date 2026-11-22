import type { EditorDraft } from '../../contracts/drafts.ts';

const CHECKPOINT_INTERVAL = 30_000;

type ReadDraft = () => EditorDraft | null;
type WriteDraft = (
  draft: EditorDraft | null,
  sequence: number,
) => Promise<void>;

/** One editor's recovery writes, ordered independently of original saves. */
export class DraftCheckpoint {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nextTick = 0;
  private generation = 0;
  private pending = Promise.resolve();
  private saved: EditorDraft | null = null;
  private readonly write: WriteDraft;
  private readonly onError: (error: unknown) => void;

  constructor(write: WriteDraft, onError: (error: unknown) => void) {
    this.write = write;
    this.onError = onError;
  }

  remember(draft: EditorDraft) {
    if (!this.saved || draft.sequence >= this.saved.sequence)
      this.saved = draft;
  }

  schedule(read: ReadDraft) {
    if (this.timer !== undefined) return;
    const generation = this.generation;
    const now = Date.now();
    const due = this.nextTick > now ? this.nextTick : now + CHECKPOINT_INTERVAL;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.nextTick = due + CHECKPOINT_INTERVAL;
      void this.flush(() =>
        generation === this.generation ? read() : null,
      ).catch((error) => {
        if (generation !== this.generation) return;
        this.onError(error);
        this.schedule(read);
      });
    }, due - now);
  }

  flush(read: ReadDraft) {
    return this.enqueue(async () => {
      const draft = read();
      if (draft) await this.replace(draft, draft.sequence);
    });
  }

  clear(sequence: number) {
    return this.enqueue(() => this.replace(null, sequence));
  }

  // Removing a finished gesture changes only what was already on disk.
  reviseSaved(
    revise: (
      saved: EditorDraft,
    ) =>
      | { draft: EditorDraft | null; sequence: number }
      | undefined
      | Promise<{ draft: EditorDraft | null; sequence: number } | undefined>,
  ) {
    return this.enqueue(async () => {
      if (!this.saved) return;
      const revised = await revise(this.saved);
      if (revised) await this.replace(revised.draft, revised.sequence);
    });
  }

  cancelTimer() {
    this.generation++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.nextTick = 0;
  }

  private enqueue(operation: () => Promise<void>) {
    const next = this.pending.catch(() => undefined).then(operation);
    this.pending = next;
    return next;
  }

  private async replace(draft: EditorDraft | null, sequence: number) {
    const saved = this.saved;
    if (saved && saved.sequence > sequence) return;
    if (
      (!saved && !draft) ||
      (saved &&
        draft &&
        saved.title === draft.title &&
        saved.body === draft.body &&
        saved.relativePath === draft.relativePath &&
        saved.baseTitle === draft.baseTitle)
    )
      return;
    await this.write(draft, sequence);
    this.saved = draft;
  }
}
