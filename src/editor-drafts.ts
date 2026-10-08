import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
export type EditorDraft = { title: string; body: string; sequence: number };
export class EditorDraftStore {
  private queues = new Map<string, Promise<void>>();
  private directory: string;
  constructor(directory: string) {
    this.directory = directory;
  }
  private filename(key: string) {
    if (typeof key !== 'string' || key.length > 1000)
      throw new Error('초안 식별자가 올바르지 않습니다.');
    return path.join(
      this.directory,
      createHash('sha256').update(key).digest('hex') + '.json',
    );
  }
  async get(key: string): Promise<EditorDraft | null> {
    await this.queues.get(key);
    return this.read(this.filename(key));
  }
  private async read(filename: string): Promise<EditorDraft | null> {
    try {
      return JSON.parse(await fs.readFile(filename, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  set(key: string, draft: EditorDraft | null, sequence: number) {
    const filename = this.filename(key);
    if (
      !Number.isSafeInteger(sequence) ||
      (draft &&
        (typeof draft.title !== 'string' ||
          typeof draft.body !== 'string' ||
          draft.body.length > 2_000_000))
    )
      throw new Error('초안 내용이 올바르지 않습니다.');
    const next = (this.queues.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const current = await this.read(filename);
        if (current && current.sequence > sequence) return;
        if (
          draft &&
          current?.sequence === sequence &&
          current.title === draft.title &&
          current.body === draft.body
        )
          return;
        await fs.mkdir(this.directory, { recursive: true });
        if (!draft) {
          await fs.rm(filename, { force: true });
          return;
        }
        const temporary = filename + '-' + randomUUID() + '.tmp';
        await fs.writeFile(temporary, JSON.stringify({ ...draft, sequence }), {
          mode: 0o600,
          flush: true,
        });
        await fs.rename(temporary, filename);
      });
    this.queues.set(key, next);
    return next;
  }
  async flush() {
    await Promise.all(this.queues.values());
  }
}
