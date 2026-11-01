import assert from 'node:assert/strict';
import { test } from 'node:test';
import matter from 'gray-matter';
import {
  reduceCollaboration,
  checkSnapshot,
} from '../src/collaboration-model.ts';
import {
  describePreview,
  htmlHash,
  htmlSourceId,
  htmlSourcePath,
  sourceMetadata,
} from '../src/html-source.ts';
import { managedPreviewPaths, isPreviewPath } from '../src/preview-output.ts';
import { previewNameCodec } from '../src/adapters/markdown/preview-names.ts';
import {
  inspectFileNames,
  applyFileNamePlan,
} from '../src/application/editing/file-name-plan.ts';
import { remapLayoutMarkdown } from '../src/adapters/markdown/layout-links.ts';
import { remapPendingLayout } from '../src/adapters/markdown/layout-snapshot.ts';
import { invertEdit } from '../src/edit-journal.ts';
import {
  remapResultChanges,
  relocateResults,
  legacyResultMoves,
} from '../src/result-structure.ts';
import { filesystemProjectRepository } from '../src/adapters/filesystem/local-project-repository.ts';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const codec = {
  parse: matter,
  stringify: (body, data) => matter.stringify(body, data),
};
const doc = (id, title, body = '본문') =>
  matter.stringify(body, { id, title, type: 'idea' });
const html =
  '<!doctype html><html><body><a href="index.html#start">다시</a><img src="picture.png"><h1>원본 게임</h1></body></html>';
const rename = (files, path, name) =>
  reduceCollaboration(files, 'documents:rename', {
    scope: 'x',
    relativePath: path,
    objectId: matter(files[path]).data.id,
    expectedTitle: matter(files[path]).data.title,
    expectedBody: matter(files[path]).content.trim(),
    name,
  }).files;
test('HTML entry rename preserves identity, parsed self links, resources, title content and managed listing', () => {
  const path = 'output/index.html',
    id = htmlSourceId(path);
  const before = {
    [path]: html,
    'output/resource.html': '<p>보조 파일</p>',
    'docs/ref.md': doc('ref', '참고', '[게임](../output/index.html)'),
  };
  const after = reduceCollaboration(before, 'preview:rename', {
    scope: 'x',
    relativePath: path,
    objectId: id,
    expectedHash: htmlHash(html),
    name: '전투 화면',
  }).files;
  checkSnapshot(after);
  assert.equal(after[path], undefined);
  assert.match(after['output/전투 화면.html'], /전투%20화면.html#start/);
  assert.match(after['output/전투 화면.html'], /src="picture.png"/);
  assert.match(after['output/전투 화면.html'], /<h1>원본 게임<\/h1>/);
  assert.match(after['docs/ref.md'], /전투%20화면.html/);
  const preview = describePreview(after, 'output/전투 화면.html');
  assert.equal(preview.sourceId, id);
  assert.equal(preview.title, '전투 화면');
  assert.equal(preview.version, 1);
  assert.equal(preview.identityPath, path);
  assert.deepEqual(managedPreviewPaths(after), ['output/전투 화면.html']);
  assert.equal(isPreviewPath('output/../evil.html'), false);
  assert.equal(
    matter(after[htmlSourcePath('output/전투 화면.html')]).data.id,
    id,
  );
});
test('versioned legacy HTML keeps its version and script references are blocked without changing bytes', () => {
  const path = 'output/versions/v7-game.html';
  const files = { [path]: '<body>게임</body>' };
  const after = reduceCollaboration(files, 'preview:rename', {
    scope: 'x',
    relativePath: path,
    objectId: htmlSourceId(path),
    expectedHash: htmlHash(files[path]),
    name: '버전 게임',
  }).files;
  assert.equal(
    describePreview(after, 'output/versions/버전 게임.html').version,
    7,
  );
  const source =
    '<body><a href="index.html">링크</a><script>fetch("index.html")</script></body>';
  assert.throws(
    () =>
      reduceCollaboration({ 'output/index.html': source }, 'preview:rename', {
        scope: 'x',
        relativePath: 'output/index.html',
        objectId: htmlSourceId('output/index.html'),
        expectedHash: htmlHash(source),
        name: '다른 이름',
      }),
    /스크립트/,
  );
});
test('offline snapshots follow identity through repeated renames and reuse of an old filename', () => {
  const base = { 'docs/a.md': doc('a', 'a'), 'docs/b.md': doc('b', 'b') };
  const local = { ...base, 'docs/a.md': doc('a', 'a', '미전송 본문') };
  let server = rename(base, 'docs/a.md', '새 이름');
  server = rename(server, 'docs/새 이름.md', '최종 이름');
  server = rename(server, 'docs/b.md', 'a');
  const mapped = remapPendingLayout(server, base, local);
  assert.equal(matter(mapped.local['docs/최종 이름.md']).data.id, 'a');
  assert.equal(
    matter(mapped.local['docs/최종 이름.md']).content.trim(),
    '미전송 본문',
  );
  assert.equal(matter(mapped.local['docs/a.md']).data.id, 'b');
});
test('batch inspection is read-only, proposes readable collisions and rejects a stale preview', () => {
  const files = {
    'docs/uuid.md': doc('a', '새 이름'),
    'docs/새 이름.md': doc('b', '새 이름'),
    'project.md': doc('root', '프로젝트'),
  };
  const copy = structuredClone(files),
    plan = inspectFileNames(
      files,
      'scope',
      codec,
      previewNameCodec,
      remapLayoutMarkdown,
    );
  assert.deepEqual(files, copy);
  assert.equal(plan.needsLayoutUpgrade, true);
  assert.equal(plan.proposals.find((p) => p.id === 'a').name, '새 이름 (2)');
  const proposals = plan.proposals.filter((p) => !p.error);
  const next = applyFileNamePlan(
    files,
    { scope: plan.scope, baseline: plan.baseline, proposals },
    codec,
    remapLayoutMarkdown,
    previewNameCodec,
  ).files;
  assert.equal(matter(next['docs/새 이름 (2).md']).data.id, 'a');
  assert.throws(
    () =>
      applyFileNamePlan(
        { ...files, 'docs/extra.md': doc('extra', 'extra') },
        { scope: 'scope', baseline: plan.baseline, proposals },
        codec,
        remapLayoutMarkdown,
        previewNameCodec,
      ),
    /다시 확인/,
  );
});

test('old body and HTML history follow subsequent renames while rename Undo keeps its original paths', () => {
  const before = {
    'docs/a.md': doc('a', 'a', 'old body'),
    'output/index.html': html,
  };
  const edited = {
    ...before,
    'docs/a.md': doc('a', 'a', 'new body'),
    'output/index.html': html.replace('원본 게임', '새 콘텐츠'),
  };
  let current = rename(edited, 'docs/a.md', '첫 이름');
  current = rename(current, 'docs/첫 이름.md', '최종 이름');
  current = reduceCollaboration(current, 'preview:rename', {
    scope: 's',
    relativePath: 'output/index.html',
    objectId: htmlSourceId('output/index.html'),
    expectedHash: htmlHash(edited['output/index.html']),
    name: '게임 이름',
  }).files;
  const restored = invertEdit(current, before, edited, 'undo');
  assert.equal(
    matter(restored['docs/최종 이름.md']).content.trim(),
    'old body',
  );
  assert.equal(matter(restored['docs/최종 이름.md']).data.title, '최종 이름');
  assert.equal(restored['docs/a.md'], undefined);
  assert.match(restored['output/게임 이름.html'], /원본 게임/);
  assert.match(restored['output/게임 이름.html'], /게임%20이름.html#start/);
  const changes = remapResultChanges(current, {
    'output/index.html': html,
    'docs/a.md': before['docs/a.md'],
  });
  assert.equal(changes['output/index.html'], undefined);
  assert.equal(matter(changes['docs/최종 이름.md']).data.title, '최종 이름');
});

test('Windows HTML case-only moves and their inverse preserve source identity, resources and directory casing', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-html-name-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const relative = 'output/games/v7-game/index.html';
  await fs.mkdir(path.join(root, path.dirname(relative)), { recursive: true });
  await fs.writeFile(path.join(root, relative), '<body>keep</body>');
  await fs.writeFile(
    path.join(root, path.dirname(relative), 'resource.js'),
    'window.kept=true;',
  );
  const repository = filesystemProjectRepository(root),
    before = await repository.capture();
  const plan = reduceCollaboration(before, 'preview:rename', {
    scope: 's',
    relativePath: relative,
    objectId: htmlSourceId(relative),
    expectedHash: htmlHash(before[relative]),
    name: 'INDEX',
  }).files;
  const diff = (a, b) =>
    Object.fromEntries(
      Object.keys({ ...a, ...b })
        .filter((p) => a[p] !== b[p])
        .map((p) => [p, b[p] ?? null]),
    );
  await repository.apply(before, diff(before, plan));
  assert.ok(
    (await fs.readdir(path.join(root, path.dirname(relative)))).includes(
      'INDEX.html',
    ),
  );
  assert.equal(
    describePreview(
      await repository.capture(),
      'output/games/v7-game/INDEX.html',
    ).sourceId,
    htmlSourceId(relative),
  );
  await repository.apply(plan, diff(plan, before));
  assert.ok(
    (await fs.readdir(path.join(root, path.dirname(relative)))).includes(
      'index.html',
    ),
  );
  assert.equal(
    await fs.readFile(
      path.join(root, path.dirname(relative), 'resource.js'),
      'utf8',
    ),
    'window.kept=true;',
  );
  assert.deepEqual(await repository.capture(), before);
  // A later category move preserves the stable HTML ID established by renaming.
  const moved = relocateResults(plan, [
    {
      from: 'output/games/v7-game/INDEX.html',
      to: 'output/content/game/v007/INDEX.html',
    },
  ]);
  checkSnapshot(moved);
  assert.equal(
    describePreview(moved, 'output/content/game/v007/INDEX.html').sourceId,
    htmlSourceId(relative),
  );
  const oldControl = sourceMetadata(relative, before[relative]);
  const changes = remapResultChanges(moved, {
    [htmlSourcePath(relative)]: oldControl,
  });
  assert.equal(
    matter(changes[htmlSourcePath('output/content/game/v007/INDEX.html')]).data
      .title,
    'INDEX',
  );
  checkSnapshot({ ...moved, ...changes });
  const legacy = legacyResultMoves({
    ...plan,
    'output/resource.html': '<body>support</body>',
  });
  assert.equal(legacy.length, 1);
  assert.match(legacy[0].to, /\/v007\/INDEX\.html$/);
});
