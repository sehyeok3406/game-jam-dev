import assert from 'node:assert/strict';
import { test } from 'node:test';
import matter from '../src/markdown.ts';
import { buildFixture } from './helpers/game-build.mjs';
import { gameBuildCodec as codec } from '../src/adapters/node/game-build-codec.ts';
import {
  validateGameBuilds,
  readGameBuildIndex,
} from '../src/core/projects/game-build.ts';
import { gameBuildEditingInputs } from '../src/core/projects/game-build-editing.ts';
import { gameBuildStatus } from '../src/core/projects/game-build-status.ts';
import { planPreviewName } from '../src/application/editing/preview-name-plan.ts';
import { planDocumentName } from '../src/application/editing/document-name-plan.ts';
import { previewNameCodec } from '../src/adapters/markdown/preview-names.ts';
import { remapLayoutMarkdown } from '../src/adapters/markdown/layout-links.ts';
import { describePreview } from '../src/html-source.ts';
const markdown = {
  parse: matter,
  stringify: (body, data) => matter.stringify(body, data),
};
test('source-backed HTML and design document renames retain build identity, immutable provenance and editable inputs', () => {
  const f = buildFixture({
    before: {
      'docs/rules.md': matter.stringify('Original rules', {
        id: 'rules',
        title: '규칙',
        type: 'system',
        sources: [],
      }),
    },
  });
  const originalManifest = f.files[f.prefix + '/manifest.json'];
  const preview = describePreview(f.files, f.artifact.path);
  const named = planPreviewName(
    f.files,
    {
      relativePath: f.artifact.path,
      objectId: preview.sourceId,
      expectedHash: codec.digest(preview.content),
      name: '새 게임 이름',
    },
    markdown,
    remapLayoutMarkdown,
    previewNameCodec,
  );
  validateGameBuilds(named.files, codec);
  assert.equal(
    readGameBuildIndex(named.files).artifacts[0].path,
    named.change.to,
  );
  assert.equal(named.files[f.prefix + '/manifest.json'], originalManifest);
  const oldRaw = named.files['docs/rules.md'];
  const doc = planDocumentName(
    named.files,
    {
      scope: 'test',
      relativePath: 'docs/rules.md',
      objectId: 'rules',
      expectedTitle: '규칙',
      expectedBody: matter(oldRaw).content.trim(),
      name: '새 규칙 이름',
    },
    markdown,
    remapLayoutMarkdown,
  );
  validateGameBuilds(doc.files, codec);
  assert.equal(doc.files[f.prefix + '/manifest.json'], originalManifest);
  const selected = gameBuildEditingInputs(doc.files, named.change.to, matter);
  assert.ok(selected.includes(doc.change.to));
  assert.ok(!selected.includes('docs/rules.md'));
  const status = gameBuildStatus(doc.files, named.change.to, codec, matter);
  assert.equal(status.documents[0].path, doc.change.to);
  assert.equal(status.documents[0].title, '새 규칙 이름');
  assert.ok(!['missing', 'replaced'].includes(status.documents[0].state));
});
