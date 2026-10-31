import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import type { JoinIdentity } from '../../contracts/project-names.ts';
import type {
  CollaborationCredentials,
  OfflineDraft,
} from '../../collaboration-client.ts';
import { historyId, projectPath } from '../../project-store.ts';
import { canonical } from '../../trash-files.ts';

type Encryption = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};
export type StoredCollaboration = {
  credentials: CollaborationCredentials | null;
  localRoot: string | null;
};
export class CollaborationSessionStore {
  readonly filename: string;
  private encryption: Encryption;
  constructor(directory: string, encryption: Encryption) {
    this.filename = path.join(directory, 'collaboration-session.enc');
    this.encryption = encryption;
  }
  async save(session: StoredCollaboration) {
    if (!this.encryption.isEncryptionAvailable()) return;
    const payload = this.encryption.encryptString(JSON.stringify(session));
    await fs.writeFile(this.filename, payload);
  }
  private joinFile(input: {
    serverUrl: string;
    code: string;
    nickname: string;
  }) {
    return path.join(
      path.dirname(this.filename),
      'pending-joins',
      createHash('sha256')
        .update(
          JSON.stringify([
            input.serverUrl.replace(/\/$/, ''),
            input.code.replace(/[\s-]/g, '').toUpperCase(),
          ]),
        )
        .digest('hex') + '.enc',
    );
  }
  async prepareJoin(input: {
    serverUrl: string;
    code: string;
    nickname: string;
  }): Promise<JoinIdentity> {
    if (!this.encryption.isEncryptionAvailable())
      throw Error('공동 참여 정보를 암호화해 보관할 수 없습니다.');
    const filename = this.joinFile(input);
    try {
      return JSON.parse(
        this.encryption.decryptString(await fs.readFile(filename)),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const identity = {
      id: randomUUID(),
      token: randomBytes(32).toString('hex'),
    };
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(
      filename,
      this.encryption.encryptString(JSON.stringify(identity)),
      { flag: 'wx', mode: 0o600, flush: true },
    );
    return identity;
  }
  async finishJoin(input: {
    serverUrl: string;
    code: string;
    nickname: string;
  }) {
    await fs.rm(this.joinFile(input), { force: true });
  }
  async read(): Promise<StoredCollaboration> {
    return JSON.parse(
      this.encryption.decryptString(await fs.readFile(this.filename)),
    );
  }
  async removeReferences(projectId: string | undefined, root: string) {
    try {
      const session = await this.read();
      const sameProject =
        !!projectId && session.credentials?.projectId === projectId;
      const sameRoot =
        !!session.localRoot && canonical(session.localRoot) === canonical(root);
      if (sameProject || sameRoot) {
        if (sameProject) session.credentials = null;
        if (sameRoot) session.localRoot = null;
        await this.save(session);
      }
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'ENOENT' &&
        this.encryption.isEncryptionAvailable()
      )
        throw error;
    }
  }
  async backupOffline(
    root: string,
    offline: OfflineDraft | null,
    assertCurrent: () => void,
  ) {
    assertCurrent();
    if (!offline) return;
    const payload = JSON.stringify(offline);
    const directory = await projectPath(
      root,
      `.history/offline-resolution-${historyId()}`,
    );
    await fs.mkdir(directory, { recursive: true });
    assertCurrent();
    await fs.writeFile(path.join(directory, 'draft.json'), payload, {
      mode: 0o600,
    });
    assertCurrent();
  }
}
