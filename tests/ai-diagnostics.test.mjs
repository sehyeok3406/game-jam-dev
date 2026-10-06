import assert from 'node:assert/strict';
import { test } from 'node:test';
import matter from 'gray-matter';
import { inspectHtml } from '../src/html-document.ts';
import {
  CanvasError,
  failureInfo,
  errorText,
  redactDiagnostic,
} from '../src/app-errors.ts';
import {
  documentOutputs,
  documentSets,
  resolveDocumentOutputs,
  reservePaths,
} from '../src/document-output.ts';
import { validateArtifacts } from '../src/ai-artifacts.ts';

test('valid implicit HTML structure is parsed, not rejected by a literal body regex', () => {
  const result = inspectHtml(
    '<!doctype html><html lang="ko"><meta charset="utf-8"><title>game</title><style>canvas{background:black}</style><main><canvas></canvas><button>play</button></main><script>let day=1;</script>',
    'output/versions/v2.html',
  );
  assert.equal(result.implicitBody, true);
  assert.match(result.normalized, /<head>.*<meta/s);
  assert.match(result.normalized, /<body><main>/);
  assert.match(result.normalized, /<script>let day=1;/);
  for (const raw of [
    '',
    'not an HTML file',
    '```html\n<html><body>game</body></html>\n```',
  ])
    assert.throws(
      () => inspectHtml(raw),
      (error) => error.code === 'GC-HTML-001',
    );
  assert.throws(
    () => inspectHtml('<html><head><title>empty</title></head></html>'),
    (error) => error.code === 'GC-HTML-005',
  );
});
test('document versions reserve paths without overwriting a previous game', () => {
  assert.deepEqual(
    resolveDocumentOutputs([], { mode: 'new' }),
    documentOutputs(),
  );
  const paths = [...documentOutputs(), ...documentOutputs('docs/versions/v4')];
  assert.deepEqual(
    resolveDocumentOutputs(paths, { mode: 'new' }),
    documentOutputs('docs/versions/v5'),
  );
  assert.deepEqual(
    resolveDocumentOutputs(paths, { mode: 'update', baseDir: 'docs' }),
    documentOutputs(),
  );
  assert.deepEqual(
    resolveDocumentOutputs(paths, {
      mode: 'update',
      baseDir: 'docs/versions/v4',
    }),
    documentOutputs('docs/versions/v4'),
  );
  for (const baseDir of [
    '../docs',
    'docs/versions/v1',
    'docs/versions/v02',
    'docs/other',
    'docs/versions/v9007199254740992',
  ])
    assert.throws(
      () => resolveDocumentOutputs(paths, { mode: 'update', baseDir }),
      (e) => e.code === 'GC-AI-004',
    );
  assert.deepEqual(
    documentSets(paths).map((set) => set.version),
    [1, 4],
  );
  const files = {
    '.ai/tasks/reserved.md': matter.stringify('task', {
      expected_outputs: documentOutputs('docs/versions/v6'),
    }),
  };
  assert.deepEqual(
    resolveDocumentOutputs(
      reservePaths(files, (raw) => matter(raw).data.expected_outputs),
      { mode: 'new' },
    ),
    documentOutputs('docs/versions/v7'),
  );
});
test('new document IDs are unique, while overwriting preserves existing IDs', () => {
  const md = (id, source = 'idea') =>
    matter.stringify('body', {
      id,
      title: id,
      type: 'system',
      status: 'draft',
      sources: [{ id: source }],
    });
  const before = { 'ideas/a.md': md('idea'), 'docs/core-loop.md': md('old') };
  validateArtifacts(
    before,
    { ...before, 'docs/versions/v2/core-loop.md': md('new') },
    ['docs/versions/v2/core-loop.md'],
  );
  assert.throws(
    () =>
      validateArtifacts(
        before,
        { ...before, 'docs/versions/v2/core-loop.md': md('old') },
        ['docs/versions/v2/core-loop.md'],
      ),
    (e) => e.code === 'GC-MD-002',
  );
  assert.throws(
    () =>
      validateArtifacts(
        before,
        { ...before, 'docs/core-loop.md': md('different') },
        ['docs/core-loop.md'],
      ),
    (e) => e.code === 'GC-MD-002',
  );
  validateArtifacts(
    before,
    { ...before, 'docs/core-loop.md': md('old') + '\nchanged' },
    ['docs/core-loop.md'],
  );
});
test('structured error codes and redacted diagnostics remain valid JSON', () => {
  const failure = failureInfo(
    new CanvasError('GC-HTML-002', 'syntax failure', {
      relativePath: 'output/versions/v2.html',
      line: 12,
    }),
  );
  assert.equal(failure.code, 'GC-HTML-002');
  assert.equal(failure.details.line, 12);
  assert.equal(failureInfo(new Error(errorText(failure))).code, failure.code);
  const redacted = redactDiagnostic(
    JSON.stringify({
      token: 'privateToken',
      api_key: 'privateApiKey',
      log: 'Bearer privateBearer; sk-privateSecret https://alice:password@demo.test apiKey=privateAssignment',
    }),
  );
  assert.doesNotThrow(() => JSON.parse(redacted));
  for (const secret of [
    'privateToken',
    'privateApiKey',
    'privateBearer',
    'privateSecret',
    'password',
    'privateAssignment',
  ])
    assert.ok(!redacted.includes(secret));
  assert.match(redacted, /REDACTED/);
});
