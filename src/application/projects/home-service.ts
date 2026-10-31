import type {
  HomeProjectRegistry,
  HomeLocalProjects,
  HomeSharedProjects,
  HomeProjectSession,
  HomeProjectTrash,
  SharedLifecycleAction,
} from '../ports/home-projects.ts';
import { projectDirectoryName } from '../../core/projects/project-name.ts';

type Ports = {
  registry: HomeProjectRegistry;
  local: HomeLocalProjects;
  shared: HomeSharedProjects;
  session: HomeProjectSession;
  trash: HomeProjectTrash;
  parseConnection(text: string): { projectId: string; serverUrl: string };
  serverAddress(url: string): string;
  chooseParent(): Promise<string | null>;
  reveal(root: string): void | Promise<void>;
  registerSelected?(
    token: string,
    name: string | null,
  ): Promise<import('../../contracts/project.ts').WorkspaceState>;
  tidySharedFolder?(id: string): Promise<void>;
  createShared?(
    input: import('../../contracts/project-mode.ts').CreateProjectInput,
  ): Promise<import('../../contracts/project.ts').WorkspaceState>;
  beforeOpen?(id: string): Promise<void>;
  changed(): void;
  stopViewer(): void;
  drainViewer(): Promise<void>;
  pauseSaves(): Promise<void>;
  drainCache(): Promise<void>;
  startViewer(): void;
};

/** Home operations are serialized by desktop IPC; no account or server is required for local use. */
export class ProjectHomeService {
  private ports: Ports;
  constructor(ports: Ports) {
    this.ports = ports;
  }
  async list(refreshShared = false) {
    const p = this.ports;
    const entries = await Promise.all(
      p.registry.list().map(async (saved) => {
        const entry = { ...saved };
        if (entry.kind === 'shared') {
          try {
            const cache = await p.shared.cache(entry.id);
            entry.pendingChanges = cache.pendingChanges;
            entry.role ??= cache.role;
            entry.createdAt = cache.createdAt;
            entry.modifiedAt = cache.modifiedAt;
          } catch {
            /* A first connection may have no cache. */
          }
          if (refreshShared === true) {
            try {
              entry.lifecycle = await p.shared.lifecycle(entry.id, 'lifecycle');
              if (entry.lifecycle.status !== 'active') return entry;
              Object.assign(entry, await p.shared.metadata(entry.id));
              if (p.registry.observeName)
                await p.registry.observeName(entry.id, entry.name, entry.role);
              else
                await p.registry.renameProject(
                  entry.id,
                  entry.name,
                  entry.role,
                );
            } catch {
              /* Keep the last known name and membership while offline. */
            }
          }
          entry.current = p.session.current().sharedId === entry.projectId;
          entry.connected = entry.current
            ? p.session.current().connected
            : undefined;
        } else {
          const current = p.session.current();
          entry.current = !current.sharedId && current.root === entry.root;
          try {
            entry.name = await p.local.name(entry.root!);
            if (entry.name !== saved.name)
              await p.registry.observeName?.(entry.id, entry.name);
            Object.assign(entry, await p.local.timestamps(entry.root!));
          } catch {
            /* Keep unavailable local projects in the list. */
          }
        }
        return entry;
      }),
    );
    const latest = new Map(p.registry.list().map((entry) => [entry.id, entry]));
    return entries.map((entry) => {
      const current = latest.get(entry.id);
      if (current && 'nameConflict' in current)
        entry.nameConflict = current.nameConflict;
      if (current && 'folderNamePending' in current)
        entry.folderNamePending = current.folderNamePending;
      return entry;
    });
  }
  folders() {
    return this.ports.registry.listFolders();
  }
  move(id: string, folder: string | null) {
    return this.ports.registry.moveProject(id, folder);
  }
  createFolder(name: string) {
    return this.ports.registry.createFolder(name);
  }
  renameFolder(id: string, name: string) {
    return this.ports.registry.renameFolder(id, name);
  }
  removeFolder(id: string) {
    return this.ports.registry.removeFolder(id);
  }
  async rename(id: string, inputName: string, expectedName?: string) {
    const name = projectDirectoryName(inputName);
    const entry = this.ports.registry.get(id);
    if (name === entry.name) return;
    if (this.ports.registry.assertNameAvailable) await this.list();
    const run = () => this.renameNamed(id, name, expectedName);
    return this.ports.registry.withName
      ? this.ports.registry.withName(name, entry.id, run)
      : run();
  }
  private async renameNamed(
    id: string,
    inputName: string,
    expectedName?: string,
  ) {
    const p = this.ports,
      name = projectDirectoryName(inputName),
      entry = p.registry.get(id);
    if (entry.kind === 'shared') {
      p.registry.assertNameAvailable?.(name, entry.id);
      const result = await p.shared.rename(
        id,
        name,
        expectedName ?? entry.name,
      );
      await p.registry.renameProject(id, result.name, result.role);
    } else {
      p.registry.assertNameAvailable?.(name, entry.id);
      await p.local.rename(entry.root!, name, expectedName);
      await p.registry.renameProject(id, name);
    }
    p.changed();
  }
  async home() {
    await this.ports.session.suspend();
    await this.ports.session.checkHost();
  }
  async open(id: string) {
    const p = this.ports;
    if (p.trash.hasProject(id)) throw Error('휴지통에서 먼저 복원해주세요.');
    await p.beforeOpen?.(id);
    const entry = p.registry.get(id),
      current = p.session.current();
    if (
      (entry.kind === 'shared' && current.sharedId === entry.projectId) ||
      (entry.kind === 'local' &&
        !current.sharedId &&
        current.root === entry.root)
    )
      return p.session.workspace();
    if (entry.kind === 'local') {
      const root = await p.local.directory(entry.root!);
      await p.session.suspend();
      return p.session.openLocal(root);
    }
    await p.session.suspend();
    return p.session.openShared(id);
  }
  chooseParent() {
    return this.ports.chooseParent();
  }
  async create(
    input:
      | string
      | import('../../contracts/project-mode.ts').CreateProjectInput,
  ) {
    const name = projectDirectoryName(
      typeof input === 'string' ? input : input.name,
    );
    if (this.ports.registry?.assertNameAvailable) await this.list();
    const run = () => this.createNamed(input);
    return this.ports.registry?.withName
      ? this.ports.registry.withName(name, undefined, run)
      : run();
  }
  private async createNamed(
    input:
      | string
      | import('../../contracts/project-mode.ts').CreateProjectInput,
  ) {
    const p = this.ports,
      name = projectDirectoryName(
        typeof input === 'string' ? input : input.name,
      );
    p.registry?.assertNameAvailable?.(name);
    if (typeof input !== 'string' && input.mode === 'shared') {
      if (!p.createShared)
        throw Error('이 환경에서는 공동 프로젝트를 생성할 수 없습니다.');
      return p.createShared({ ...input, name });
    }
    if (typeof input !== 'string' && (input.mode !== 'local' || !input.parent))
      throw Error('프로젝트 방식과 저장 위치를 선택해주세요.');
    const parent =
      typeof input === 'string' ? await p.chooseParent() : input.parent;
    if (!parent) return p.session.workspace();
    const root = await p.local.create(parent, name);
    await p.session.suspend();
    return p.session.openLocal(root);
  }
  registerSelected(token: string, name: string | null) {
    if (!this.ports.registerSelected) throw Error('PC 앱을 업데이트해주세요.');
    return this.ports.registerSelected(token, name);
  }
  async tidySharedFolder(id: string) {
    const p = this.ports;
    const entry = p.registry.get(id);
    if (entry.kind !== 'shared' || p.trash.hasProject(id))
      throw Error('공유 프로젝트를 선택해주세요.');
    p.registry.assertNameAvailable?.(entry.name, entry.id);
    if (!p.tidySharedFolder) throw Error('PC 앱을 업데이트해주세요.');
    p.stopViewer();
    try {
      await p.drainViewer();
      await p.session.suspend();
      await p.pauseSaves();
      await p.drainCache();
      await p.tidySharedFolder(id);
      p.changed();
    } finally {
      p.startViewer();
    }
  }
  async reveal(id: string) {
    const p = this.ports,
      entry = p.registry.get(id);
    if (p.trash.hasProject(id)) throw Error('휴지통에서 먼저 복원해주세요.');
    if (entry.kind === 'shared') {
      if (!p.shared.directory)
        throw Error('로컬 사본을 표시할 수 없는 환경입니다.');
      const result = await p.shared.directory(id);
      await p.reveal(result.root);
      return { offline: result.offline };
    }
    if (!entry.root) throw Error('프로젝트 폴더를 찾을 수 없습니다.');
    await p.reveal(await p.local.directory(entry.root));
    return { offline: false };
  }
  private assertDisconnected(id: string, message: string) {
    if (
      this.ports.session.current().sharedId ===
      this.ports.registry.get(id).projectId
    )
      throw Error(message);
  }
  async server(id: string, url: string) {
    this.assertDisconnected(id, '홈으로 돌아온 뒤 서버 주소를 변경해주세요.');
    await this.ports.registry.updateServer(id, this.ports.serverAddress(url));
  }
  inspectConnection(text: string) {
    const info = this.ports.parseConnection(text);
    const entry =
      this.ports.registry.findShared?.(info.projectId, info.serverUrl) ??
      this.ports.registry.get(`shared:${info.projectId}`);
    if (!this.ports.registry.hasSharedSession(entry.id))
      throw Error(
        '이 프로젝트의 참여 세션이 없습니다. 초대 코드로 참여해주세요.',
      );
    return {
      id: entry.id,
      name: entry.name,
      serverUrl: info.serverUrl,
      previousUrl: entry.serverUrl,
    };
  }
  async applyConnection(text: string) {
    const entry = this.inspectConnection(text);
    this.assertDisconnected(
      entry.id,
      '홈으로 돌아온 뒤 연결 정보를 적용해주세요.',
    );
    await this.ports.registry.updateServer(entry.id, entry.serverUrl);
  }
  lifecycle(id: string, action: SharedLifecycleAction, input: object = {}) {
    return this.ports.shared.lifecycle(id, action, input);
  }
  prepareTrash(id: string) {
    return this.ports.trash.prepare(id);
  }
  listTrash() {
    return this.ports.trash.list();
  }
  restore(id: string) {
    return this.ports.trash.restore(id);
  }
  acknowledgeRestore(id: string) {
    return this.ports.trash.acknowledgeRestore(id);
  }
  purge(id: string, name: string, discard: boolean) {
    return this.ports.trash.purge(id, name, discard);
  }
  retryTrash() {
    return this.ports.trash.maintain();
  }
  async trash(token: string, storage: Record<string, string>) {
    const p = this.ports;
    p.stopViewer();
    try {
      await p.drainViewer();
      await p.session.suspend();
      await p.pauseSaves();
      await p.drainCache();
      return await p.trash.trash(token, storage);
    } finally {
      p.startViewer();
    }
  }
}
