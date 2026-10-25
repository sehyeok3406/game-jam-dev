import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { ModeSnapshot } from '../../contracts/project-mode.ts';
import type { Snapshot } from '../../contracts/project.ts';
import {
  captureProject,
  materialize,
  applyChanges,
  saveHistory,
  projectPath,
  recoverInterruptedHistory,
} from '../../project-store.ts';
import { saveProjectName } from '../../project-metadata.ts';

type Encryption = {
  isEncryptionAvailable(): boolean;
  encryptString(text: string): Buffer;
  decryptString(data: Buffer): string;
};
export const snapshotFingerprint = (files: Snapshot) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
      ),
    )
    .digest('hex');
export type LocalAttempt = ModeSnapshot & {
  id: string;
  libraryId: string;
  target: string;
  before: Snapshot;
  proof: string;
  successorId?: string;
  credentials: import('../../collaboration-client.ts').CollaborationCredentials;
  committed: boolean;
};
/** Private journals and public prepared files are separate; credentials never enter a workspace. */
export class ProjectModeFiles {
  private directory: string;
  private encryption: Encryption;
  constructor(directory: string, encryption: Encryption) {
    this.directory = directory;
    this.encryption = encryption;
  }
  private folder() {
    return path.join(this.directory, 'project-transitions');
  }
  private filename(id: string) {
    if (!/^[a-z0-9-]{1,100}$/.test(id))
      throw Error('전환 기록 ID가 올바르지 않습니다.');
    return path.join(this.folder(), id + '.enc');
  }
  async write(id: string, value: unknown) {
    if (!this.encryption.isEncryptionAvailable())
      throw Error('프로젝트 전환에는 OS 암호화 저장소가 필요합니다.');
    const target = this.filename(id);
    await fs.mkdir(this.folder(), { recursive: true });
    const temporary = target + '.' + randomUUID() + '.tmp';
    try {
      await fs.writeFile(
        temporary,
        this.encryption.encryptString(JSON.stringify(value)),
        { mode: 0o600, flag: 'wx' },
      );
      await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  async read<T>(id: string): Promise<T | null> {
    try {
      return JSON.parse(
        this.encryption.decryptString(await fs.readFile(this.filename(id))),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async ids(prefix: string) {
    return (
      await fs.readdir(this.folder()).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      })
    )
      .filter((name) => name.startsWith(prefix) && name.endsWith('.enc'))
      .map((name) => name.slice(0, -4));
  }
  async remove(id: string) {
    await fs.rm(this.filename(id), { force: true });
  }
  async prepare(attempt: LocalAttempt) {
    const staging = path.join(this.folder(), attempt.id + '-prepared');
    await fs.mkdir(staging, { recursive: true });
    await materialize(staging, attempt.files);
    if (
      snapshotFingerprint(await captureProject(staging)) !==
      snapshotFingerprint(attempt.files)
    )
      throw Error('로컬 전환 준비 파일을 검증하지 못했습니다.');
    await this.write('local-' + attempt.id, attempt);
  }
  async finish(attempt: LocalAttempt) {
    await fs.mkdir(attempt.target, { recursive: true });
    await recoverInterruptedHistory(attempt.target);
    const current = await captureProject(attempt.target);
    if (snapshotFingerprint(current) !== snapshotFingerprint(attempt.files)) {
      if (snapshotFingerprint(current) !== snapshotFingerprint(attempt.before))
        throw Error(
          '로컬 대상 폴더가 변경되었습니다. 준비 자료는 보관했습니다. 외부 변경을 보존한 뒤 다시 시도해주세요.',
        );
      const changes = Object.fromEntries(
        Object.keys({ ...current, ...attempt.files }).map((key) => [
          key,
          attempt.files[key] ?? null,
        ]),
      );
      await saveHistory(attempt.target, current, attempt.files, {
        id: 'mode-' + attempt.id,
        label: '공동 프로젝트에서 로컬로 전환',
        kind: 'user',
        status: 'completed',
        createdAt: Date.now(),
        finishedAt: Date.now(),
      });
      await applyChanges(attempt.target, current, changes);
    }
    await saveProjectName(attempt.target, attempt.name);
    const authorship = await projectPath(
      attempt.target,
      '.canvas/authorship.json',
    );
    await fs.mkdir(path.dirname(authorship), { recursive: true });
    const temporary = authorship + '.mode.tmp';
    await fs.writeFile(
      temporary,
      JSON.stringify({ version: 1, files: attempt.authorship }),
    );
    await fs.rename(temporary, authorship);
  }
}
