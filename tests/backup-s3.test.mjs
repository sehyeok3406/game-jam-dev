import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { S3BackupTarget } from '../src/adapters/backup/s3-target.ts';
import { backupEnvironment } from '../src/server/operations/backup-config.ts';
import { backupKey } from '../src/application/ports/backup-target.ts';

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-s3-test-')),
    objects = new Map(),
    requests = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost'),
      key = decodeURIComponent(url.pathname.slice('/private-bucket/'.length));
    requests.push({ method: req.method, headers: req.headers, key });
    if (options.deny) {
      res.writeHead(403, { 'content-type': 'application/xml' });
      res.end(
        '<Error><Code>AccessDenied</Code><Message>denied</Message></Error>',
      );
      return;
    }
    if (req.method === 'PUT') {
      if (objects.has(key) && req.headers['if-none-match'] === '*') {
        res.writeHead(412);
        res.end();
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const sha = createHash('sha256').update(body).digest('base64');
      if (req.headers['x-amz-checksum-sha256'] !== sha) {
        res.writeHead(400);
        res.end('<Error><Code>BadDigest</Code></Error>');
        return;
      }
      objects.set(key, body);
      res.writeHead(200, { 'x-amz-checksum-sha256': sha });
      res.end();
      return;
    }
    if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? '';
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(
        '<ListBucketResult><IsTruncated>false</IsTruncated>' +
          [...objects]
            .filter(([k]) => k.startsWith(prefix))
            .map(
              ([k, v]) =>
                `<Contents><Key>${k}</Key><Size>${v.length}</Size></Contents>`,
            )
            .join('') +
          '</ListBucketResult>',
      );
      return;
    }
    if (req.method === 'DELETE') {
      objects.delete(key);
      res.writeHead(204);
      res.end();
      return;
    }
    const body = objects.get(key);
    if (!body) {
      res.writeHead(404);
      res.end();
      return;
    }
    const sha = createHash('sha256').update(body).digest('base64');
    res.writeHead(200, {
      'content-length': body.length,
      ...(!options.omitChecksum
        ? {
            'x-amz-checksum-sha256': options.wrongChecksum
              ? 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
              : sha,
          }
        : {}),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const target = new S3BackupTarget({
    endpoint: `http://127.0.0.1:${server.address().port}`,
    allowLoopbackHttp: true,
    bucket: 'private-bucket',
    region: 'test-region-1',
    prefix: 'isolated/backups',
    accessKeyId: 'FAKE_ACCESS_KEY',
    secretAccessKey: 'FAKE_SECRET_KEY',
  });
  t.after(async () => {
    target.close();
    await new Promise((r) => server.close(r));
    await fs.rm(root, { recursive: true, force: true });
  });
  const filename = path.join(root, 'source.gjbackup'),
    body = Buffer.from('인공 백업 바이트 ' + randomUUID());
  await fs.writeFile(filename, body);
  const sha256 = createHash('sha256').update(body).digest('hex'),
    backupId = randomUUID(),
    createdAt = new Date().toISOString();
  const object = {
    key: backupKey(backupId, createdAt, sha256),
    size: body.length,
    sha256,
    backupId,
    createdAt,
  };
  return { root, target, objects, requests, filename, body, object };
}

test('S3 adapter uses signed private-bucket requests and checks SHA-256/size on upload and download', async (t) => {
  const f = await fixture(t);
  await f.target.put(f.filename, f.object);
  await f.target.put(f.filename, f.object);
  assert.equal(f.objects.size, 1);
  assert.match(
    f.requests.find((r) => r.method === 'PUT').headers.authorization,
    /AWS4-HMAC-SHA256 Credential=FAKE_ACCESS_KEY/,
  );
  assert.equal(
    f.requests.find((r) => r.method === 'PUT').headers['x-amz-acl'],
    undefined,
  );
  assert.deepEqual(await f.target.list(), [f.object]);
  const destination = path.join(f.root, 'download');
  await f.target.get(f.object, destination);
  assert.deepEqual(await fs.readFile(destination), f.body);
  await f.target.remove(f.object);
  assert.deepEqual(await f.target.list(), []);
});

test('S3-compatible endpoints without a SHA-256 response require full content verification, not metadata/ETag', async (t) => {
  const f = await fixture(t, { omitChecksum: true });
  await f.target.put(f.filename, f.object);
  assert.ok(f.requests.some((r) => r.method === 'GET' && !r.key.includes('?')));
  f.objects.set(
    'isolated/backups/' + f.object.key,
    Buffer.from('x'.repeat(f.body.length)),
  );
  const destination = path.join(f.root, 'corrupt');
  await assert.rejects(f.target.get(f.object, destination), /SHA-256/);
  assert.equal(await fs.stat(destination).catch(() => null), null);
});

test('wrong remote checksum or denied storage rejects the upload', async (t) => {
  const wrong = await fixture(t, { wrongChecksum: true });
  await assert.rejects(
    wrong.target.put(wrong.filename, wrong.object),
    /SHA-256/,
  );
  const denied = await fixture(t, { deny: true });
  await assert.rejects(
    denied.target.put(denied.filename, denied.object),
    /denied/,
  );
});

test('S3 configuration requires explicit credentials/HTTPS and rejects URL secrets and partial environment', () => {
  const options = {
    bucket: 'private',
    region: 'r',
    accessKeyId: 'fake',
    secretAccessKey: 'fake',
  };
  for (const endpoint of [
    'http://example.com',
    'https://user:pass@example.com',
    'https://example.com?secret=x',
  ])
    assert.throws(() => new S3BackupTarget({ ...options, endpoint }), /HTTPS/);
  assert.equal(backupEnvironment('data', {}), undefined);
  assert.throws(
    () =>
      backupEnvironment('data', {
        GAMEJAM_BACKUP_S3_ENDPOINT: 'https://example.com',
      }),
    /모두/,
  );
});
