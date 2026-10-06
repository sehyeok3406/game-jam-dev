import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CollaborationCredentials } from './collaboration-client.ts';
import type { ProjectEntry } from './shared.ts';
import {
  displayHomeProjects,
  editHomeOrganization,
  readHomeOrganization,
  homeName,
  type HomeEdit,
  type HomeOrganization,
} from './home-organization.ts';

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
  private home: HomeOrganization = { folders: [], projects: [] };
  private queue: Promise<unknown> = Promise.resolve();
  private registryQueue: Promise<void> = Promise.resolve();
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
    try {
      this.home = readHomeOrganization(
        await fs.readFile(
          path.join(this.directory, 'home-organization.json'),
          'utf8',
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  list(): ProjectEntry[] {
    return displayHomeProjects(
      this.entries
        .map(
          ({ credentials: _credentials, localRoot: _localRoot, ...entry }) => ({
            ...entry,
          }),
        )
        .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt),
      this.home,
    );
  }
  listFolders() {
    return structuredClone(this.home.folders);
  }
  async renameProject(id: string, name: string, role?: ProjectEntry['role']) {
    const entry = this.get(id);
    return this.upsert({
      ...entry,
      name: homeName(name),
      ...(entry.kind === 'shared' && role ? { role } : {}),
    });
  }
  moveProject(id: string, folderId: string | null) {
    this.get(id);
    return this.editHome({ type: 'move-project', id, folderId });
  }
  createFolder(name: string) {
    return this.editHome({ type: 'create-folder', id: randomUUID(), name });
  }
  renameFolder(id: string, name: string) {
    return this.editHome({ type: 'rename-folder', id, name });
  }
  removeFolder(id: string) {
    return this.editHome({ type: 'remove-folder', id });
  }
  private editHome(edit: HomeEdit) {
    const next = this.queue
      .catch(() => undefined)
      .then(async () => {
        const home = editHomeOrganization(this.home, edit);
        await fs.mkdir(this.directory, { recursive: true });
        const target = path.join(this.directory, 'home-organization.json');
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
          await fs.writeFile(temporary, JSON.stringify(home), { mode: 0o600 });
          await fs.rename(temporary, target);
          this.home = home;
        } finally {
          await fs.rm(temporary, { force: true }).catch(() => undefined);
        }
      });
    this.queue = next;
    return next;
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
    return this.modifyEntries(() =>
      this.entries.filter((entry) => entry.projectId !== projectId),
    );
  }
  private async upsert(item: SavedProject) {
    return this.modifyEntries(() => [
      ...this.entries.filter((entry) => entry.id !== item.id),
      structuredClone(item),
    ]);
  }
  private modifyEntries(operation: () => SavedProject[]) {
    const next = this.registryQueue
      .catch(() => undefined)
      .then(async () => {
        const previous = this.entries;
        this.entries = operation();
        try {
          await this.save();
        } catch (error) {
          this.entries = previous;
          throw error;
        }
      });
    this.registryQueue = next;
    return next;
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
        try {
          await fs.writeFile(temporary, secured ?? locals, { mode: 0o600 });
          await fs.rename(temporary, target);
        } finally {
          await fs.rm(temporary, { force: true }).catch(() => undefined);
        }
      });
    this.queue = next;
    return next;
  }
}
