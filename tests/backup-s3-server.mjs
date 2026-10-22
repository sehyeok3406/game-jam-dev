import https from 'node:https';
import { createHash } from 'node:crypto';

/** Isolated TLS S3 protocol fixture. Never connects to external services. */
export async function startBackupS3Server({ key, cert, beforePut }) {
  const objects = new Map(),
    requests = [];
  const server = https.createServer({ key, cert }, async (req, res) => {
    try {
      const url = new URL(req.url, 'https://localhost'),
        key = decodeURIComponent(url.pathname.slice('/private-bucket/'.length));
      requests.push({
        method: req.method,
        key,
        authorization: req.headers.authorization,
      });
      if (req.method === 'PUT') {
        if (objects.has(key) && req.headers['if-none-match'] === '*') {
          res.writeHead(412);
          res.end();
          return;
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks),
          checksum = createHash('sha256').update(body).digest('base64');
        if (req.headers['x-amz-checksum-sha256'] !== checksum) {
          res.writeHead(400);
          res.end('<Error><Code>BadDigest</Code></Error>');
          return;
        }
        await beforePut?.();
        objects.set(key, body);
        res.writeHead(200, { 'x-amz-checksum-sha256': checksum });
        res.end();
        return;
      }
      if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
        const prefix = url.searchParams.get('prefix') ?? '';
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(
          '<ListBucketResult><IsTruncated>false</IsTruncated>' +
            [...objects]
              .filter(([key]) => key.startsWith(prefix))
              .map(
                ([key, value]) =>
                  `<Contents><Key>${key}</Key><Size>${value.length}</Size></Contents>`,
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
      res.writeHead(200, {
        'content-length': body.length,
        'x-amz-checksum-sha256': createHash('sha256')
          .update(body)
          .digest('base64'),
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.destroy();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    objects,
    requests,
    url: `https://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((r) => {
        server.close(r);
        server.closeAllConnections();
      }),
  };
}
