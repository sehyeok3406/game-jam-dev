import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  DiscordApprovalSettings,
  DiscordProjectBinding,
} from './discord-approval-types.ts';

export type DiscordNotification = {
  messageId: string;
  revision: number;
  signature: string;
  threadId?: string;
  announced?: string;
};
export type DiscordSavedApproval = {
  version: 1;
  token: string;
  settings: DiscordApprovalSettings;
  binding: DiscordProjectBinding;
  notifications: Record<string, DiscordNotification>;
};
type Encryption = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

/** Credentials and notification receipts never enter project files or renderer state. */
export class DiscordApprovalStore {
  private file: string;
  private queue: Promise<void> = Promise.resolve();
  private encryption: Encryption;
  constructor(directory: string, encryption: Encryption) {
    this.encryption = encryption;
    this.file = path.join(directory, 'discord-approval.enc');
  }
  async load(): Promise<DiscordSavedApproval | null> {
    try {
      if (!this.encryption.isEncryptionAvailable())
        throw Error('암호화 저장소를 사용할 수 없습니다.');
      const value = JSON.parse(
        this.encryption.decryptString(await fs.readFile(this.file)),
      );
      if (
        value.version !== 1 ||
        !value.token ||
        !value.binding ||
        !value.settings ||
        !value.notifications
      )
        throw Error('Invalid settings');
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw Error(
        '디스코드 설정을 읽지 못했습니다. 연결을 해제한 뒤 다시 설정해주세요.',
      );
    }
  }
  save(value: DiscordSavedApproval) {
    // Capture now; later in-memory receipt updates must not change an earlier write.
    const raw = JSON.stringify(value);
    return this.write(async () => {
      if (!this.encryption.isEncryptionAvailable())
        throw Error('암호화 저장소를 사용할 수 없습니다.');
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      try {
        await fs.writeFile(temporary, this.encryption.encryptString(raw));
        await fs.rename(temporary, this.file);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    });
  }
  clear() {
    return this.write(() => fs.rm(this.file, { force: true }));
  }
  private write(action: () => Promise<void>) {
    const pending = this.queue.catch(() => undefined).then(action);
    this.queue = pending;
    return pending;
  }
}
