import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CollaborationCredentials } from './collaboration-client.ts';
import type { ProjectEntry } from './shared.ts';

type SavedProject = ProjectEntry & {
  credentials?: CollaborationCredentials;
  localRoot?: string | null;
};
type Encryption = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

/** Credentials never cross IPC. The whole shared-project registry is protected by OS encryption. */
export class ProjectLibrary {
  private directory: string;
  private encryption: Encryption;
  private entries: SavedProject[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  constructor(directory: string, encryption: Encryption) {
    this.directory = directory;
    this.encryption = encryption;
  }
  async load() {
    try {
      const raw = await fs.readFile(path.join(this.directory, 'projects.enc'));
      this.entries = JSON.parse(this.encryption.decryptString(raw));
      if (!Array.isArray(this.entries)) this.entries = [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error(
          '저장된 프로젝트 목록을 읽지 못했습니다. OS 세션 저장 상태를 확인해주세요.',
        );
    }
    try {
      const locals: SavedProject[] = JSON.parse(
        await fs.readFile(
          path.join(this.directory, 'local-projects.json'),
          'utf8',
        ),
      );
      for (const item of locals)
        if (!this.entries.some((entry) => entry.id === item.id))
          this.entries.push(item);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  list(): ProjectEntry[] {
    return this.entries
      .map(
        ({ credentials: _credentials, localRoot: _localRoot, ...entry }) => ({
          ...entry,
        }),
      )
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  }
  get(id: string) {
    const item = this.entries.find((entry) => entry.id === id);
    if (!item) throw new Error('프로젝트를 찾을 수 없습니다.');
    return structuredClone(item);
  }
  assertSecureSession() {
    if (!this.encryption.isEncryptionAvailable())
      throw new Error(
        '공동 세션을 안전하게 기억하려면 Windows 암호화 저장소를 사용할 수 있어야 합니다.',
      );
  }
  async rememberLocal(root: string, name: string) {
    return this.upsert({
      id: `local:${root.toLowerCase()}`,
      name,
      kind: 'local',
      root,
      lastOpenedAt: Date.now(),
    });
  }
  async rememberShared(
    credentials: CollaborationCredentials,
    name: string,
    role: ProjectEntry['role'],
    localRoot: string | null,
  ) {
    this.assertSecureSession();
    const id = `shared:${credentials.projectId}`;
    return this.upsert({
      id,
      name,
      kind: 'shared',
      serverUrl: credentials.serverUrl,
      projectId: credentials.projectId,
      credentials,
      role,
      localRoot,
      lastOpenedAt: Date.now(),
    });
  }
  async updateServer(id: string, serverUrl: string) {
    const entry = this.get(id);
    if (!entry.credentials) throw new Error('공동 프로젝트를 선택해주세요.');
    entry.serverUrl = serverUrl;
    entry.credentials.serverUrl = serverUrl;
    return this.upsert(entry);
  }
  async forgetSession(projectId: string) {
    this.entries = this.entries.filter(
      (entry) => entry.projectId !== projectId,
    );
    await this.save();
  }
  private async upsert(item: SavedProject) {
    const previous = structuredClone(this.entries);
    this.entries = [
      ...this.entries.filter((entry) => entry.id !== item.id),
      structuredClone(item),
    ];
    try {
      await this.save();
    } catch (error) {
      this.entries = previous;
      throw error;
    }
  }
  private save() {
    const locals = JSON.stringify(
      this.entries.filter((entry) => entry.kind === 'local'),
    );
    const secured = this.encryption.isEncryptionAvailable()
      ? this.encryption.encryptString(JSON.stringify(this.entries))
      : null;
    const next = this.queue
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(this.directory, { recursive: true });
        const target = path.join(
          this.directory,
          secured ? 'projects.enc' : 'local-projects.json',
        );
        const temporary = `${target}.${randomUUID()}.tmp`;
        await fs.writeFile(temporary, secured ?? locals, { mode: 0o600 });
        await fs.rename(temporary, target);
      });
    this.queue = next;
    return next;
  }
}
