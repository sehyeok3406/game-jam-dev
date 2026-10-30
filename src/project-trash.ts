import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { projectPath } from './project-store.ts';
import { randomUUID } from 'node:crypto';
import { ProjectLibrary, type SavedProject } from './project-library.ts';
import type { ProjectTrashEntry } from './shared.ts';
import {
  atomicJson,
  canonical,
  inside,
  checkAncestors,
  moveChecked,
  purgeChecked,
  statDirectory,
  TRASH_RETENTION,
} from './trash-files.ts';
import { projectStorageKey } from './project-trash-keys.ts';
type Encryption = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};
type RecordEntry = ProjectTrashEntry & {
  saved: SavedProject;
  identity: string | null;
  data: unknown;
  path: string;
};
type Hooks = {
  capture(entry: SavedProject, keys: string[]): Promise<unknown>;
  remove(entry: SavedProject, data: unknown): Promise<void>;
  restore(entry: SavedProject, data: unknown): Promise<void>;
};
export class ProjectTrash {
  private records = new Map<string, RecordEntry>();
  private plans = new Map<
    string,
    {
      entry: SavedProject;
      root: string;
      identity: string | null;
      until: number;
      done?: string;
    }
  >();
  private directory: string;
  private library: ProjectLibrary;
  private encryption: Encryption;
  private hooks: Hooks;
  private protectedPaths: string[];
  constructor(
    directory: string,
    library: ProjectLibrary,
    encryption: Encryption,
    hooks: Hooks,
    protectedPaths: string[] = [],
  ) {
    this.directory = directory;
    this.library = library;
    this.encryption = encryption;
    this.hooks = hooks;
    this.protectedPaths = protectedPaths;
  }
  private filename(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw Error('휴지통 ID가 올바르지 않습니다.');
    return path.join(this.directory, 'project-trash', `${id}.json`);
  }
  private expected(record: RecordEntry) {
    return path.join(
      path.dirname(record.originalPath),
      '.gamejam-trash',
      record.trashId,
      'project',
    );
  }
  private async save(record: RecordEntry) {
    const raw = JSON.stringify(record);
    if (record.kind === 'shared' && !this.encryption.isEncryptionAvailable())
      throw Error('접속 정보를 암호화해 보관할 수 없습니다.');
    await atomicJson(
      this.filename(record.trashId),
      this.encryption.isEncryptionAvailable()
        ? { encrypted: this.encryption.encryptString(raw).toString('base64') }
        : { local: record },
    );
    this.records.set(record.trashId, record);
  }
  async load() {
    for (const name of await fs
      .readdir(path.join(this.directory, 'project-trash'))
      .catch(() => [] as string[])) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const value = JSON.parse(
        await fs.readFile(
          path.join(this.directory, 'project-trash', name),
          'utf8',
        ),
      );
      const record: RecordEntry = value.encrypted
        ? JSON.parse(
            this.encryption.decryptString(
              Buffer.from(value.encrypted, 'base64'),
            ),
          )
        : value.local;
      if (
        !record ||
        this.filename(record.trashId) !==
          path.join(this.directory, 'project-trash', name) ||
        canonical(record.path) !== canonical(this.expected(record))
      )
        throw Error('휴지통 기록이 손상되었습니다.');
      this.records.set(record.trashId, record);
    }
  }
  list(): ProjectTrashEntry[] {
    return Array.from(this.records.values()).map(
      ({ saved: _s, data: _d, path: _p, identity: _i, ...publicEntry }) =>
        publicEntry,
    );
  }
  hasProject(id: string) {
    return Array.from(this.records.values()).some((r) => r.projectId === id);
  }
  hasSharedProject(projectId: string) {
    return Array.from(this.records.values()).some(
      (r) => r.saved.kind === 'shared' && r.saved.projectId === projectId,
    );
  }
  hasRoot(root: string) {
    return Array.from(this.records.values()).some(
      (r) =>
        canonical(r.originalPath) === canonical(root) ||
        inside(r.path, root) ||
        (!!r.saved.credentials?.localFingerprint &&
          !!r.saved.localRoot &&
          canonical(r.saved.localRoot) === canonical(root)),
    );
  }
  async prepare(id: string) {
    if (this.hasProject(id)) throw Error('이미 휴지통에 있는 프로젝트입니다.');
    const entry = this.library.get(id);
    if (
      entry.kind === 'shared' &&
      !/^[a-f0-9-]{36}$/.test(entry.projectId ?? '')
    )
      throw Error('공동 프로젝트 ID가 올바르지 않습니다.');
    entry.folderId = this.library.list().find((e) => e.id === id)?.folderId;
    const root =
      entry.kind === 'local'
        ? entry.root!
        : path.join(this.directory, 'shared-workspaces', entry.projectId!);
    if (!path.isAbsolute(root))
      throw Error('프로젝트 경로가 올바르지 않습니다.');
    if (
      root
        .split(/[\\/]/)
        .some((part) => ['.gamejam-trash', '.project-trash'].includes(part)) ||
      Array.from(this.records.values()).some((r) => inside(root, r.path))
    )
      throw Error('다른 휴지통 자료를 포함한 경로는 옮길 수 없습니다.');
    await checkAncestors(root);
    await fs.realpath(path.dirname(root));
    const blocked = [
      os.homedir(),
      path.join(os.homedir(), 'Desktop'),
      path.join(os.homedir(), 'Documents'),
      this.directory,
      ...this.protectedPaths,
    ].filter(Boolean);
    if (path.dirname(root) === root || blocked.some((p) => inside(root, p)))
      throw Error('보호된 경로는 휴지통으로 옮길 수 없습니다.');
    for (const other of this.library.list())
      if (
        other.id !== id &&
        other.root &&
        (inside(root, other.root) || inside(other.root, root))
      )
        throw Error('다른 프로젝트와 중첩된 폴더는 옮길 수 없습니다.');
    const identity = await statDirectory(root);
    if (entry.kind === 'local' && identity) {
      const marker =
        (await fs
          .stat(await projectPath(root, '.canvas/project.json'))
          .catch(() => null)) ??
        (await fs.stat(path.join(root, 'project.md')).catch(() => null));
      if (!marker) throw Error('프로젝트 폴더인지 확인할 수 없습니다.');
    }
    const token = randomUUID();
    this.plans.set(token, {
      entry,
      root,
      identity,
      until: Date.now() + 300_000,
    });
    return {
      token,
      entry: { id: entry.id, name: entry.name, kind: entry.kind, root },
      missing: !identity,
    };
  }
  async trash(token: string, storage: Record<string, string>) {
    const plan = this.plans.get(token);
    if (!plan || plan.until < Date.now())
      throw Error('삭제 확인이 만료되었습니다. 다시 확인해주세요.');
    if (plan.done) return plan.done;
    const existing = Array.from(this.records.values()).find(
      (r) => r.projectId === plan.entry.id,
    );
    if (existing) return existing.trashId;
    if (
      (await statDirectory(plan.root)) !== plan.identity ||
      this.library.get(plan.entry.id).name !== plan.entry.name
    )
      throw Error('프로젝트가 변경되었습니다. 다시 확인해주세요.');
    const identities = [
      plan.entry.id,
      plan.root,
      plan.entry.projectId ?? '',
      `local:${plan.root}`,
      `shared:${plan.entry.projectId}`,
    ].filter(Boolean);
    if (
      Object.entries(storage).some(
        ([key, value]) =>
          !projectStorageKey(key, identities) ||
          typeof value !== 'string' ||
          value.length > 5_000_000,
      )
    )
      throw Error('보관할 화면 상태가 올바르지 않습니다.');
    const id = randomUUID();
    const record: RecordEntry = {
      trashId: id,
      projectId: plan.entry.id,
      name: plan.entry.name,
      kind: plan.entry.kind,
      originalPath: plan.root,
      path: path.join(path.dirname(plan.root), '.gamejam-trash', id, 'project'),
      identity: plan.identity,
      saved: plan.entry,
      data: await this.hooks.capture(plan.entry, Object.keys(storage)),
      storage,
      pendingWork: true,
      stage: 'moving',
    };
    await this.save(record);
    plan.done = id;
    await this.finishMove(record);
    return id;
  }
  private async finishMove(record: RecordEntry) {
    await moveChecked(record.originalPath, record.path, record.identity);
    await this.hooks.remove(record.saved, record.data);
    await this.library.removeProject(record.projectId);
    record.stage = 'retained';
    record.trashedAt = Date.now();
    record.expiresAt = Date.now() + TRASH_RETENTION;
    record.error = undefined;
    await this.save(record);
  }
  async restore(id: string) {
    const record = this.get(id);
    if (
      record.stage !== 'restoring' &&
      (record.stage !== 'retained' || record.expiresAt! <= Date.now())
    )
      throw Error('복원 가능한 보관 기간이 아닙니다.');
    if (
      record.stage !== 'restoring' &&
      this.library.list().some((e) => e.id === record.projectId)
    )
      throw Error('같은 프로젝트가 이미 등록되어 있습니다.');
    record.stage = 'restoring';
    await this.save(record);
    await moveChecked(record.path, record.originalPath, record.identity);
    await this.hooks.restore(record.saved, record.data);
    await this.library.restoreEntry(record.saved);
    return record.storage;
  }
  async acknowledgeRestore(id: string) {
    const r = this.get(id);
    if (r.stage !== 'restoring') throw Error('복원 중인 항목이 아닙니다.');
    await fs.unlink(this.filename(id));
    this.records.delete(id);
  }
  private get(id: string) {
    this.filename(id);
    const r = this.records.get(id);
    if (!r) throw Error('휴지통 항목을 찾을 수 없습니다.');
    return r;
  }
  async purge(id: string, typedName?: string, discard = false) {
    const record = this.get(id);
    if (record.stage !== 'retained' && record.stage !== 'purging')
      throw Error('휴지통 이동을 먼저 완료해주세요.');
    if (
      record.expiresAt! > Date.now() &&
      record.stage !== 'purging' &&
      (typedName !== record.name || !discard)
    )
      throw Error('이름과 미반영 자료의 영구 삭제를 확인해주세요.');
    record.stage = 'purging';
    await this.save(record);
    await purgeChecked(record.path, this.expected(record), record.identity);
    await fs.unlink(this.filename(id));
    this.records.delete(id);
  }
  async maintain() {
    for (const r of Array.from(this.records.values())) {
      try {
        if (r.stage === 'moving') await this.finishMove(r);
        else if (
          r.stage === 'purging' ||
          (r.stage === 'retained' && r.expiresAt! <= Date.now())
        )
          await this.purge(r.trashId);
      } catch (error) {
        r.error = error instanceof Error ? error.message : String(error);
        await this.save(r);
      }
    }
  }
}
