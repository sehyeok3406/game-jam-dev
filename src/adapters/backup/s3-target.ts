import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type {
  BackupTarget,
  BackupObject,
} from '../../application/ports/backup-target.ts';
import { parseBackupKey } from '../../application/ports/backup-target.ts';
import {
  fileHash,
  portablePath,
  BackupLimits,
} from '../../server/operations/backup-files.ts';
import { checkAncestors } from '../../trash-files.ts';

type Options = {
  endpoint: string;
  bucket: string;
  region: string;
  prefix?: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  allowLoopbackHttp?: boolean;
};
/** Explicit credentials and immutable keys. Endpoint URLs cannot contain secrets. */
export class S3BackupTarget implements BackupTarget {
  private client: S3Client;
  private bucket: string;
  private prefix: string;
  constructor(options: Options) {
    const url = new URL(options.endpoint);
    if (
      (url.protocol !== 'https:' &&
        !(
          options.allowLoopbackHttp &&
          url.protocol === 'http:' &&
          ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
        )) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('백업 S3 endpoint는 HTTPS 주소여야 합니다.');
    if (
      !options.bucket ||
      !options.region ||
      !options.accessKeyId ||
      !options.secretAccessKey
    )
      throw new Error('백업 S3 설정이 누락되었습니다.');
    this.bucket = options.bucket;
    this.prefix = options.prefix ?? 'gamejam-backups';
    portablePath(this.prefix);
    this.client = new S3Client({
      endpoint: url.href,
      region: options.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        sessionToken: options.sessionToken,
      },
      maxAttempts: 2,
      requestHandler: { connectionTimeout: 10000, requestTimeout: 30000 },
    });
  }
  private key(object: BackupObject) {
    const p = parseBackupKey(object.key, object.size);
    if (p.sha256 !== object.sha256 || p.backupId !== object.backupId)
      throw new Error('백업 object 식별자가 다릅니다.');
    return `${this.prefix}/${object.key}`;
  }
  private async download(object: BackupObject, destination?: string) {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.key(object) }),
    );
    const body = response.Body;
    if (!body || response.ContentLength !== object.size) {
      (body as { destroy?: () => void })?.destroy?.();
      throw new Error('S3 백업 크기가 다릅니다.');
    }
    let output: Awaited<ReturnType<typeof fs.open>> | null = null;
    const hash = createHash('sha256');
    let size = 0,
      failed = false;
    try {
      if (destination) {
        await checkAncestors(destination);
        output = await fs.open(destination, 'wx', 0o600);
      }
      for await (const raw of body as AsyncIterable<Uint8Array>) {
        const chunk = Buffer.from(raw);
        size += chunk.length;
        if (
          size > object.size ||
          size > BackupLimits.archiveBytes + BackupLimits.manifestBytes
        )
          throw new Error('S3 백업 크기 한도를 초과했습니다.');
        hash.update(chunk);
        if (output) {
          let offset = 0;
          while (offset < chunk.length)
            offset += (await output.write(chunk, offset, chunk.length - offset))
              .bytesWritten;
        }
      }
      if (size !== object.size || hash.digest('hex') !== object.sha256)
        throw new Error('S3 백업 SHA-256 검증에 실패했습니다.');
      await output?.sync();
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await output?.close();
      (body as { destroy?: () => void }).destroy?.();
      if (failed && destination && output)
        await fs.unlink(destination).catch(() => undefined);
    }
  }
  async put(filename: string, object: BackupObject) {
    const actual = await fileHash(filename);
    if (actual.sha256 !== object.sha256 || actual.size !== object.size)
      throw new Error('S3 업로드 원본 검증에 실패했습니다.');
    const body = createReadStream(filename);
    try {
      await this.client
        .send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: this.key(object),
            Body: body,
            ContentLength: object.size,
            ChecksumSHA256: Buffer.from(object.sha256, 'hex').toString(
              'base64',
            ),
            Metadata: { sha256: object.sha256 },
            IfNoneMatch: '*',
          }),
        )
        .catch((error) => {
          if (error.$metadata?.httpStatusCode !== 412) throw error;
        });
    } finally {
      body.destroy();
    }
    const stored = await this.client.send(
      new HeadObjectCommand({
        Bucket: this.bucket,
        Key: this.key(object),
        ChecksumMode: 'ENABLED',
      }),
    );
    if (stored.ContentLength !== object.size)
      throw new Error('S3 업로드 크기 확인에 실패했습니다.');
    if (stored.ChecksumSHA256) {
      if (
        stored.ChecksumSHA256 !==
        Buffer.from(object.sha256, 'hex').toString('base64')
      )
        throw new Error('S3 업로드 SHA-256 확인에 실패했습니다.');
    } else await this.download(object);
  }
  async get(object: BackupObject, destination: string) {
    await this.download(object, destination);
  }
  async list() {
    const result: BackupObject[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: this.prefix + '/',
          ContinuationToken: token,
        }),
      );
      for (const item of page.Contents ?? []) {
        const key = item.Key?.slice(this.prefix.length + 1);
        if (key?.endsWith('.gjbackup'))
          result.push(parseBackupKey(key, item.Size));
      }
      if (result.length > 10000)
        throw new Error('S3 백업 목록 한도를 초과했습니다.');
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
      if (page.IsTruncated && !token)
        throw new Error('S3 백업 목록이 불완전합니다.');
    } while (token);
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async remove(object: BackupObject) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(object) }),
    );
  }
  close() {
    this.client.destroy();
  }
}
