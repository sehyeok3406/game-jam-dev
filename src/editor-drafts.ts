import type { EditorDraft } from './contracts/drafts.ts';
export type { EditorDraft } from './contracts/drafts.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
export const isLocalDrawingBatchDraft = (key: string) =>
  key.startsWith('game-canvas-drawing-batch:');
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
    // A failed replacement leaves the last successful file available to recover.
    await this.queues.get(key)?.catch(() => undefined);
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
          (!isLocalDrawingBatchDraft(key) && draft.body.length > 2000000)))
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
          current.body === draft.body &&
          current.relativePath === draft.relativePath &&
          current.baseTitle === draft.baseTitle
        )
          return;
        if (!draft) {
          if (current) await fs.rm(filename, { force: true });
          return;
        }
        await fs.mkdir(this.directory, { recursive: true });
        const temporary = filename + '-' + randomUUID() + '.tmp';
        try {
          await fs.writeFile(
            temporary,
            JSON.stringify({ ...draft, sequence, key }),
            { mode: 0o600, flush: true },
          );
          await fs.rename(temporary, filename);
        } catch (error) {
          await fs.rm(temporary, { force: true }).catch(() => undefined);
          throw error;
        }
      });
    this.queues.set(key, next);
    const release = () => {
      if (this.queues.get(key) === next) this.queues.delete(key);
    };
    void next.then(release, release);
    return next;
  }
  async flush() {
    await Promise.all(this.queues.values());
  }
  async relocateRoot(from: string, to: string) {
    const prefix = `game-canvas-draft:${from}:`;
    const drafts = await this.projectData((key) => key.startsWith(prefix));
    for (const [key, value] of Object.entries(drafts)) {
      const target = `game-canvas-draft:${to}:` + key.slice(prefix.length);
      const existing = await this.get(target);
      if (
        existing &&
        (existing.title !== value.title || existing.body !== value.body)
      )
        throw Error(
          '새 폴더 위치의 보관 초안이 다릅니다. 두 초안을 보존한 채 이전을 보류했습니다.',
        );
      await this.set(target, value, value.sequence);
    }
  }
  async projectData(
    matches: (key: string) => boolean,
    knownKeys: string[] = [],
  ) {
    await this.flush();
    const result: Record<string, EditorDraft> = {};
    for (const key of knownKeys) {
      const value = await this.get(key);
      if (value && matches(key)) result[key] = value;
    }
    for (const file of await fs
      .readdir(this.directory)
      .catch(() => [] as string[])) {
      if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
      const value = JSON.parse(
        await fs.readFile(path.join(this.directory, file), 'utf8'),
      );
      if (typeof value.key === 'string' && matches(value.key))
        result[value.key] = value;
    }
    return result;
  }
}
