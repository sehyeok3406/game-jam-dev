import fs from 'node:fs/promises';
import { atomicJson } from './trash-files.ts';
import {
  isQueuePending,
  queueTaskView,
  type StoredAiQueueTask,
} from './ai-task-queue.ts';

/** Durable metadata only. Processes and leases belong to the execution adapter. */
export class AiQueueStore {
  tasks: StoredAiQueueTask[] = [];
  private writes: Promise<void> = Promise.resolve();
  persistenceFailed = false;
  private filename: string;
  constructor(filename: string) {
    this.filename = filename;
  }
  async load() {
    let raw: string;
    try {
      raw = await fs.readFile(this.filename, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this;
      throw error;
    }
    const data = JSON.parse(raw);
    if (
      data.version !== 1 ||
      !Array.isArray(data.tasks) ||
      data.tasks.some(
        (t: StoredAiQueueTask) =>
          !t.taskId ||
          !t.taskPath?.startsWith('.ai/tasks/') ||
          !t.baseline ||
          !t.fileLock ||
          !t.readScope ||
          !t.writeScope,
      )
    )
      throw new Error(
        'AI 예약 정보를 읽을 수 없습니다. 예약 파일을 보존하고 확인해주세요.',
      );
    this.tasks = data.tasks;
    for (const task of this.tasks)
      if (isQueuePending(task) && task.status !== 'queued') {
        task.status = 'failed';
        task.message =
          '앱이 종료되어 실행이 중단되었습니다. 다시 요청해주세요.';
        task.updatedAt = Date.now();
      }
    await this.save();
    return this;
  }
  views() {
    return this.tasks.map(queueTaskView);
  }
  save() {
    // Keep all pending reservations; bounded terminal metadata carries no input bytes.
    const terminal = this.tasks.filter((t) => !isQueuePending(t));
    const removed = new Set(terminal.slice(0, -50));
    this.tasks = this.tasks.filter((t) => !removed.has(t));
    const snapshot = structuredClone({
      version: 1,
      tasks: this.tasks.map((t) =>
        isQueuePending(t) ? t : { ...t, baseline: {} },
      ),
    });
    const next = this.writes.then(() => atomicJson(this.filename, snapshot));
    this.writes = next.then(
      () => {
        this.persistenceFailed = false;
      },
      () => {
        this.persistenceFailed = true;
      },
    );
    return next;
  }
}
