import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { captureProject } from './project-store.ts';
import { ProjectLibrary } from './project-library.ts';
import { CollaborationClient } from './collaboration-client.ts';
import {
  projectForWeb,
  publishWebProject,
  WEB_VIEWER_URL,
} from './web-viewer.ts';
import type { CollaborationEnvelope } from './collaboration-server.ts';

export type ViewerSettings = {
  publishToken: string;
  accessCode: string;
  projects: string[];
  liveLocal: boolean;
};
type Encryption = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};
export class WebViewerService {
  private hashes = new Map<string, string>();
  private running: Promise<{ published: number; errors: string[] }> | null =
    null;
  constructor(
    private directory: string,
    private encryption: Encryption,
  ) {}
  async settings(): Promise<ViewerSettings | null> {
    try {
      const bytes = await fs.readFile(
        path.join(this.directory, 'web-viewer.enc'),
      );
      const parsed = JSON.parse(this.encryption.decryptString(bytes));
      if (
        !/^[A-Za-z0-9_-]{43}$/.test(parsed.publishToken) ||
        !/^[A-Za-z0-9_-]{43}$/.test(parsed.accessCode) ||
        !Array.isArray(parsed.projects) ||
        parsed.projects.some((id: unknown) => typeof id !== 'string')
      )
        throw new Error('웹 뷰어 연결 설정이 올바르지 않습니다.');
      return { ...parsed, liveLocal: parsed.liveLocal === true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async save(settings: ViewerSettings) {
    if (!this.encryption.isEncryptionAvailable())
      throw new Error('Windows 암호화 저장소를 사용할 수 없습니다.');
    const destination = path.join(this.directory, 'web-viewer.enc');
    await fs.mkdir(this.directory, { recursive: true });
    await fs.writeFile(
      `${destination}.tmp`,
      this.encryption.encryptString(JSON.stringify(settings)),
      { mode: 0o600 },
    );
    await fs.rename(`${destination}.tmp`, destination);
  }
  async status() {
    const settings = await this.settings();
    const status = await fs
      .readFile(path.join(this.directory, 'web-viewer-status.json'), 'utf8')
      .then(JSON.parse)
      .catch(() => null);
    return {
      configured: !!settings,
      url: WEB_VIEWER_URL,
      accessCode: settings?.accessCode ?? '',
      projects: settings?.projects ?? [],
      liveLocal: settings?.liveLocal ?? false,
      lastPublishedAt: status?.lastPublishedAt,
      errors: status?.errors ?? [],
    };
  }
  async publish(force = false) {
    if (this.running) return this.running;
    this.running = this.publishNow(force).finally(() => {
      this.running = null;
    });
    return this.running;
  }
  private async publishNow(force: boolean) {
    const settings = await this.settings();
    if (!settings) throw new Error('웹 뷰어가 아직 연결되지 않았습니다.');
    const library = new ProjectLibrary(this.directory, this.encryption);
    await library.load();
    let published = 0;
    const errors: string[] = [];
    for (const id of settings.projects) {
      try {
        const entry = library.get(id);
        if (!force && entry.kind === 'local' && !settings.liveLocal) continue;
        const envelope =
          entry.kind === 'shared'
            ? ((await CollaborationClient.fetch(
                entry.credentials!.serverUrl,
                `/projects/${entry.projectId}/state`,
                {},
                entry.credentials!.token,
              )) as CollaborationEnvelope)
            : null;
        const project = projectForWeb({
          libraryId: entry.id,
          name: envelope?.state.projectName ?? entry.name,
          files: envelope?.files ?? (await captureProject(entry.root!)),
          source:
            entry.kind === 'shared'
              ? 'shared'
              : settings.liveLocal
                ? 'local-live'
                : 'published',
          revision: envelope?.state.revision,
          folder: library
            .listFolders()
            .find((folder) => folder.id === entry.folderId)?.name,
        });
        const hash = createHash('sha256')
          .update(JSON.stringify({ ...project, publishedAt: 0 }))
          .digest('hex');
        if (!force && this.hashes.get(id) === hash) continue;
        await publishWebProject(project, settings.publishToken);
        this.hashes.set(id, hash);
        published++;
      } catch {
        // Errors must not leak raw HTTP bodies, tokens, file contents or absolute paths.
        errors.push(
          `프로젝트 ${settings.projects.indexOf(id) + 1} 게시 실패. 서버 연결·프로젝트 파일·4MB 제한을 확인해주세요.`,
        );
      }
    }
    await fs.writeFile(
      path.join(this.directory, 'web-viewer-status.json'),
      JSON.stringify({ lastPublishedAt: Date.now(), published, errors }),
      { mode: 0o600 },
    );
    return { published, errors };
  }
}
