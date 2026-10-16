import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  captureApprovalDocuments,
  discordTextPages,
  documentFilename,
} from '../src/discord-review-documents.ts';
import { DiscordBotTransport } from '../src/discord-transport.ts';

test('document capture exports only selected Markdown, hashes exact bytes and reports unsupported inputs', () => {
  const item = {
    id: 'r',
    revision: 2,
    request: {
      inputPaths: [
        'ideas/a.md',
        'output/a.html',
        '.ai/private.md',
        'ideas/a.md',
      ],
    },
  };
  const snapshot = captureApprovalDocuments(
    item,
    {
      'ideas/a.md': '# 원문\n한글 😀\n',
      'ideas/private.md': 'not selected',
      '.ai/private.md': 'never export hidden',
      'output/a.html': '<html>',
    },
    'token',
  );
  assert.deepEqual(
    snapshot.documents.map((d) => d.path),
    ['ideas/a.md'],
  );
  assert.equal(snapshot.documents[0].content, '# 원문\n한글 😀\n');
  assert.equal(snapshot.documents[0].sha256.length, 64);
  assert.deepEqual(snapshot.unsupported, ['output/a.html', '.ai/private.md']);
  assert.throws(() => captureApprovalDocuments(item, {}, 't'), /삭제/);
  assert.throws(
    () =>
      captureApprovalDocuments(
        item,
        { 'ideas/a.md': '가'.repeat(800000) },
        't',
      ),
    /2MB/,
  );
  assert.throws(
    () =>
      captureApprovalDocuments(
        {
          ...item,
          request: {
            inputPaths: Array.from({ length: 31 }, (_, i) => `ideas/${i}.md`),
          },
        },
        {},
        't',
      ),
    /30개/,
  );
});

test('Discord text pagination preserves Korean, emoji and every byte with safe page and filename lengths', () => {
  const text = '긴 문서 😀🙂\n'.repeat(1800);
  const pages = discordTextPages(text);
  assert.equal(pages.join(''), text);
  assert.ok(
    pages.every((p) => p.length <= 1500 && !/[\ud800-\udbff]$/.test(p)),
  );
  assert.match(
    documentFilename({ path: 'ideas/../기획:문서.md' }, 0, 4),
    /^1-기획_문서-r4\.md$/,
  );
});

test('real Discord transport sends files as multipart fields instead of embedding them in JSON', async () => {
  const transport = new DiscordBotTransport(
    async () => {},
    () => {},
  );
  const sent = [];
  transport.client.rest.post = async (route, options) => {
    sent.push({ route, options });
    return { id: 'wire-file' };
  };
  const data = Buffer.from('# 문서\n한글 😀');
  assert.equal(
    await transport.send('123', {
      content: 'snapshot',
      allowed_mentions: { parse: [] },
      files: [{ name: 'doc.md', data }],
    }),
    'wire-file',
  );
  assert.equal(sent[0].options.body.files, undefined);
  assert.deepEqual(sent[0].options.files[0].data, data);
  assert.equal(sent[0].options.files[0].name, 'doc.md');
  transport.close();
});
