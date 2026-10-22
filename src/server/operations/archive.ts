import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { checkAncestors } from '../../trash-files.ts';
import {
  BackupLimits,
  removeTemporary,
  recoveryPath,
  recoveryDirectory,
  regularFile,
  diskSpace,
  fileHash,
  type BackupFile,
  uuid,
} from './backup-files.ts';
import {
  inspectDatabase,
  verifyRecoveryTree,
  type ProjectSummary,
} from './backup-database.ts';

const MAGIC = Buffer.from('GAMEJAM-BACKUP/1\n');
export type BackupManifest = {
  format: 1;
  backupId: string;
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  protocolVersion: 1;
  projects: ProjectSummary[];
  tombstones: [string, number][];
  files: BackupFile[];
  directories: string[];
};
function validateManifest(m: BackupManifest) {
  if (
    !m ||
    m.format !== 1 ||
    !uuid.test(m.backupId) ||
    !Number.isFinite(Date.parse(m.createdAt)) ||
    typeof m.appVersion !== 'string' ||
    m.protocolVersion !== 1 ||
    !Number.isSafeInteger(m.schemaVersion) ||
    !Array.isArray(m.files) ||
    !Array.isArray(m.directories) ||
    !Array.isArray(m.projects) ||
    !Array.isArray(m.tombstones) ||
    m.files.length + m.directories.length > BackupLimits.entries
  )
    throw new Error('지원하지 않거나 손상된 백업 manifest입니다.');
  const seen = new Set<string>();
  for (const name of m.directories) {
    recoveryDirectory(name);
    const key = name.normalize('NFC').toLowerCase();
    if (seen.has(key)) throw new Error('중복 백업 경로입니다.');
    seen.add(key);
  }
  let total = 0;
  for (const file of m.files) {
    recoveryPath(file.path);
    const key = file.path.normalize('NFC').toLowerCase();
    if (
      seen.has(key) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw new Error('중복/손상된 백업 파일 항목입니다.');
    seen.add(key);
    total += file.size;
    if (total > BackupLimits.archiveBytes)
      throw new Error('백업 크기 한도를 초과했습니다.');
  }
  if (m.files.filter((f) => f.path === 'sync.sqlite').length !== 1)
    throw new Error('백업 DB가 누락되었습니다.');
  // A file must not also be an ancestor of another path (on any platform).
  const fileNames = new Set(
    m.files.map((f) => f.path.normalize('NFC').toLowerCase()),
  );
  for (const name of seen)
    for (
      let parent = path.posix.dirname(name);
      parent !== '.';
      parent = path.posix.dirname(parent)
    )
      if (fileNames.has(parent))
        throw new Error('백업 파일/폴더 경로가 충돌합니다.');
}
async function writeAll(handle: fs.FileHandle, buffer: Buffer) {
  let offset = 0;
  while (offset < buffer.length)
    offset += (await handle.write(buffer, offset, buffer.length - offset))
      .bytesWritten;
}
async function readExact(handle: fs.FileHandle, size: number) {
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(buffer, offset, size - offset);
    if (!bytesRead) throw new Error('백업 파일이 잘렸습니다.');
    offset += bytesRead;
  }
  return buffer;
}
export async function writeArchive(
  root: string,
  destination: string,
  manifest: BackupManifest,
) {
  validateManifest(manifest);
  const json = Buffer.from(JSON.stringify(manifest)),
    length = Buffer.alloc(4);
  if (json.length > BackupLimits.manifestBytes)
    throw new Error('백업 manifest가 너무 큽니다.');
  length.writeUInt32BE(json.length);
  const output = await fs.open(destination, 'wx', 0o600);
  try {
    await writeAll(output, MAGIC);
    await writeAll(output, length);
    await writeAll(output, json);
    for (const file of manifest.files) {
      const filename = path.join(root, ...file.path.split('/'));
      await regularFile(filename);
      const handle = await fs.open(filename, 'r');
      try {
        const hash = createHash('sha256');
        let size = 0;
        for await (const chunk of handle.createReadStream({
          autoClose: false,
        })) {
          hash.update(chunk);
          size += chunk.length;
          await writeAll(output, chunk);
        }
        if (size !== file.size || hash.digest('hex') !== file.sha256)
          throw new Error('백업 도중 파일이 변경되었습니다.');
      } finally {
        await handle.close();
      }
    }
    await output.sync();
  } finally {
    await output.close();
  }
}
/** Streaming extraction into an empty, private staging tree; no tar path/link semantics. */
export async function extractArchive(
  archive: string,
  destination: string,
): Promise<BackupManifest> {
  await checkAncestors(destination);
  const stat = await regularFile(archive);
  if (stat.size > BackupLimits.archiveBytes + BackupLimits.manifestBytes)
    throw new Error('백업 크기 한도를 초과했습니다.');
  if ((await fs.readdir(destination)).length)
    throw new Error('백업 검증 폴더는 비어 있어야 합니다.');
  const input = await fs.open(archive, 'r');
  try {
    if (!(await readExact(input, MAGIC.length)).equals(MAGIC))
      throw new Error('백업 형식이 올바르지 않습니다.');
    const length = (await readExact(input, 4)).readUInt32BE();
    if (length < 2 || length > BackupLimits.manifestBytes)
      throw new Error('백업 manifest 길이가 올바르지 않습니다.');
    const manifest = JSON.parse(
      (await readExact(input, length)).toString('utf8'),
    ) as BackupManifest;
    validateManifest(manifest);
    const expected =
      MAGIC.length +
      4 +
      length +
      manifest.files.reduce((n, f) => n + f.size, 0);
    if (stat.size !== expected)
      throw new Error('백업 크기/파일 목록이 일치하지 않습니다.');
    await diskSpace(destination, expected);
    for (const directory of manifest.directories)
      await fs.mkdir(path.join(destination, ...directory.split('/')), {
        recursive: true,
        mode: 0o700,
      });
    for (const file of manifest.files) {
      const target = path.join(destination, ...file.path.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      const output = await fs.open(target, 'wx', 0o600),
        hash = createHash('sha256');
      let remaining = file.size;
      try {
        while (remaining) {
          const chunk = await readExact(
            input,
            Math.min(remaining, 1024 * 1024),
          );
          hash.update(chunk);
          await writeAll(output, chunk);
          remaining -= chunk.length;
        }
        await output.sync();
      } finally {
        await output.close();
      }
      if (hash.digest('hex') !== file.sha256)
        throw new Error('백업 SHA-256 검증에 실패했습니다.');
    }
    const data = inspectDatabase(path.join(destination, 'sync.sqlite'));
    if (
      data.schemaVersion !== manifest.schemaVersion ||
      JSON.stringify(data.summaries) !== JSON.stringify(manifest.projects) ||
      JSON.stringify(data.tombstones) !== JSON.stringify(manifest.tombstones)
    )
      throw new Error('백업 manifest와 DB 메타데이터가 다릅니다.');
    await verifyRecoveryTree(
      destination,
      data,
      manifest.files,
      manifest.directories,
    );
    return manifest;
  } finally {
    await input.close();
  }
}
export async function verifyArchive(
  archive: string,
  scratchParent = path.dirname(archive),
) {
  const directory = await fs.mkdtemp(path.join(scratchParent, '.verify-'));
  try {
    const manifest = await extractArchive(archive, directory);
    return { manifest, ...(await fileHash(archive)) };
  } finally {
    await removeTemporary(scratchParent, directory);
  }
}
