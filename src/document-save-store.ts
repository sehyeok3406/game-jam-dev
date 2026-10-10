import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  validateDocumentSave,
  type DocumentSaveRecord,
  type DocumentSaveStorage,
} from './document-save-queue.ts';

/** One atomic record per document. No credentials or project content in filenames. */
export class DocumentSaveStore implements DocumentSaveStorage {
  private writes = new Map<string, Promise<void>>();
  private directory: string;
  constructor(directory: string) {
    this.directory = directory;
  }
  private file(scope: string, key: string) {
    return path.join(
      this.directory,
      createHash('sha256')
        .update(JSON.stringify([scope, key]))
        .digest('hex') + '.json',
    );
  }
  async load() {
    const records: DocumentSaveRecord[] = [];
    const files = await fs
      .readdir(this.directory)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
    for (const file of files.filter((file) =>
      /^[a-f0-9]{64}\.json$/.test(file),
    )) {
      const record: DocumentSaveRecord = JSON.parse(
        await fs.readFile(path.join(this.directory, file), 'utf8'),
      );
      validateDocumentSave(record.request);
      if (
        !Number.isSafeInteger(record.savedSequence) ||
        !record.base ||
        typeof record.base.title !== 'string' ||
        typeof record.base.body !== 'string'
      )
        throw new Error(
          '저장 큐 파일이 손상되었습니다. 원본 초안을 확인해주세요.',
        );
      records.push(record);
    }
    return records;
  }
  private write(file: string, operation: () => Promise<void>) {
    const next = (this.writes.get(file) ?? Promise.resolve())
      .catch(() => undefined)
      .then(operation);
    this.writes.set(file, next);
    return next;
  }
  put(record: DocumentSaveRecord) {
    const file = this.file(record.request.scope, record.request.key),
      json = JSON.stringify(record);
    return this.write(file, async () => {
      await fs.mkdir(this.directory, { recursive: true });
      const temporary = file + '-' + randomUUID() + '.tmp';
      try {
        await fs.writeFile(temporary, json, { mode: 0o600, flush: true });
        for (let attempt = 0; ; attempt++) {
          try {
            await fs.rename(temporary, file);
            break;
          } catch (error) {
            // Windows scanners/readers may hold the destination briefly.
            // Keep the old record intact; never delete it before replacement.
            if (
              attempt >= 5 ||
              !['EPERM', 'EACCES', 'EBUSY'].includes(
                (error as NodeJS.ErrnoException).code ?? '',
              )
            )
              throw error;
            await new Promise((resolve) =>
              setTimeout(resolve, 25 * 2 ** attempt),
            );
          }
        }
      } finally {
        await fs.rm(temporary, { force: true });
      }
    });
  }
  remove(scope: string, key: string) {
    const file = this.file(scope, key);
    return this.write(file, () => fs.rm(file, { force: true }));
  }
  async flush(scope?: string, key?: string) {
    if (scope && key) {
      await this.writes.get(this.file(scope, key));
      return;
    }
    await Promise.all(this.writes.values());
  }
}
