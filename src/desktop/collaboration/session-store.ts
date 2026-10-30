import fs from 'node:fs/promises';
import path from 'node:path';
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
