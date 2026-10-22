export type BackupObject = {
  key: string;
  size: number;
  sha256: string;
  createdAt: string;
  backupId: string;
};

/** Immutable objects. put/get resolve only after size and content verification. */
export interface BackupTarget {
  put(filename: string, object: BackupObject): Promise<void>;
  get(object: BackupObject, destination: string): Promise<void>;
  list(): Promise<BackupObject[]>;
  remove(object: BackupObject): Promise<void>;
}

export function backupKey(backupId: string, createdAt: string, sha256: string) {
  const key = `${new Date(createdAt).getTime()}-${backupId}-${sha256}.gjbackup`;
  parseBackupKey(key);
  return key;
}
export function parseBackupKey(key: string, size = 0): BackupObject {
  const match = /^(\d{13})-([a-f0-9-]{36})-([a-f0-9]{64})\.gjbackup$/.exec(key);
  if (!match || !Number.isSafeInteger(size) || size < 0)
    throw new Error('백업 object 이름이 올바르지 않습니다.');
  return {
    key,
    size,
    createdAt: new Date(Number(match[1])).toISOString(),
    backupId: match[2],
    sha256: match[3],
  };
}
