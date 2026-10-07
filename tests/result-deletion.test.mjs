import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import {
  reduceCollaboration,
  checkSnapshot,
} from '../src/collaboration-model.ts';
import {
  captureProject,
  materialize,
  applyChanges,
} from '../src/project-store.ts';
import { htmlSourcePath, sourceMetadata } from '../src/html-source.ts';
import { previewWindowPath } from '../src/preview-output.ts';
import { trashDeletedFiles } from '../src/result-deletion.ts';
import {
  initializeProjectDocument,
  localProjectName,
  saveProjectName,
} from '../src/project-metadata.ts';

const md = (id, extra = {}) =>
  matter.stringify('내용', {
    id,
    title: id,
    type: 'overview',
    sources: [],
    ...extra,
  });
const html = '<!doctype html><html><head></head><body>game</body></html>';
const fixture = async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'game-jam-delete-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
};

test('project document can be deleted individually, in a batch and with its section', () => {
  const files = {
    'project.md': md('project'),
    'ideas/note.md': md('note'),
    'sections/group.md': md('group', {
      members: [
        { id: 'project', path: 'project.md' },
        { id: 'note', path: 'ideas/note.md' },
      ],
    }),
  };
  const single = reduceCollaboration(files, 'documents:delete', {
    documentId: 'project',
    relativePath: 'project.md',
  }).files;
  assert.equal(single['project.md'], undefined);
  assert.deepEqual(matter(single['sections/group.md']).data.members, [
    { id: 'note', path: 'ideas/note.md' },
  ]);
  const batch = reduceCollaboration(files, 'documents:delete-many', {
    documents: [
      { documentId: 'project', relativePath: 'project.md' },
      { documentId: 'note', relativePath: 'ideas/note.md' },
    ],
  }).files;
  assert.deepEqual(matter(batch['sections/group.md']).data.members, []);
  const section = reduceCollaboration(files, 'sections:delete', {
    sectionId: 'group',
    relativePath: 'sections/group.md',
    deleteMembers: true,
  });
  assert.deepEqual(section.files, {});
  assert.equal(section.result.deletedDocumentCount, 2);
  checkSnapshot({});
});

test('reopening and renaming a project after deletion do not recreate the default document', async (t) => {
  const root = await fixture(t);
  await initializeProjectDocument(root);
  assert.ok((await captureProject(root))['project.md']);
  await saveProjectName(root, '게임 프로젝트');
  await fs.unlink(path.join(root, 'project.md'));
  await initializeProjectDocument(root);
  assert.equal((await captureProject(root))['project.md'], undefined);
  assert.equal(await localProjectName(root), '게임 프로젝트');
  await saveProjectName(root, '새 프로젝트 이름');
  assert.equal(await localProjectName(root), '새 프로젝트 이름');
});

test('HTML deletion trashes its whole owned folder, auxiliary assets, metadata and settings while preserving siblings', async (t) => {
  const root = await fixture(t);
  const relative = 'output/games/v1-game/index.html';
  const other = 'output/games/v2-other/index.html';
  const metadata = htmlSourcePath(relative);
  const files = {
    'project.md': md('project'),
    [relative]: html,
    [other]: html,
    [metadata]: sourceMetadata(relative, html),
  };
  await materialize(root, files);
  const owned = path.dirname(path.join(root, relative));
  await fs.mkdir(path.join(owned, 'assets/nested'), { recursive: true });
  await fs.writeFile(path.join(owned, 'assets/game.js'), 'game()');
  await fs.writeFile(
    path.join(owned, 'assets/image.png'),
    Buffer.from([0, 1, 255]),
  );
  const settings = path.join(root, previewWindowPath(relative));
  await fs.mkdir(path.dirname(settings), { recursive: true });
  await fs.writeFile(settings, '{}');
  const otherSettings = path.join(root, previewWindowPath(other));
  await fs.writeFile(otherSettings, '{}');
  const after = reduceCollaboration(files, 'documents:delete', {
    documentId: relative,
    relativePath: relative,
  }).files;
  assert.equal(after[metadata], undefined);
  const trashed = [];
  await trashDeletedFiles(root, files, after, async (absolute) => {
    const destination = path.join(root, `trash-${trashed.length}`);
    await fs.rename(absolute, destination);
    trashed.push({ absolute, destination });
  });
  assert.ok(trashed.some((item) => item.absolute === owned));
  const folder = trashed.find((item) => item.absolute === owned).destination;
  assert.equal(
    await fs.readFile(path.join(folder, 'assets/game.js'), 'utf8'),
    'game()',
  );
  assert.deepEqual(
    await fs.readFile(path.join(folder, 'assets/image.png')),
    Buffer.from([0, 1, 255]),
  );
  await assert.rejects(fs.access(owned));
  await assert.rejects(fs.access(settings));
  await assert.rejects(fs.access(path.join(root, metadata)));
  await fs.access(otherSettings);
  assert.equal(await fs.readFile(path.join(root, other), 'utf8'), html);
});

test('legacy and imported HTML deletions preserve shared output parents and unrelated files', async (t) => {
  const root = await fixture(t);
  for (const relative of [
    'output/index.html',
    'output/versions/v3-old.html',
    'output/imported/import-00000000-0000-0000-0000-000000000000.html',
  ]) {
    const metadata = htmlSourcePath(relative);
    const files = {
      [relative]: html,
      [metadata]: sourceMetadata(relative, html),
    };
    await materialize(root, files);
    const sibling = path.join(root, path.dirname(relative), 'keep.txt');
    await fs.writeFile(sibling, 'keep');
    const after = reduceCollaboration(files, 'documents:delete-many', {
      documents: [{ documentId: relative, relativePath: relative }],
    }).files;
    await trashDeletedFiles(root, files, after, (absolute) =>
      fs.rename(absolute, `${absolute}.trash`),
    );
    await assert.rejects(fs.access(path.join(root, relative)));
    await assert.rejects(fs.access(path.join(root, metadata)));
    assert.equal(await fs.readFile(sibling, 'utf8'), 'keep');
  }
});

test('shared snapshot deletion also cleans the local result folder after tracked HTML removal', async (t) => {
  const root = await fixture(t);
  const relative = 'output/games/v1/index.html';
  const before = { [relative]: html };
  await materialize(root, before);
  await applyChanges(root, before, { [relative]: null });
  await trashDeletedFiles(root, before, {}, (absolute) =>
    fs.rename(absolute, `${absolute}.trash`),
  );
  await assert.rejects(fs.access(path.dirname(path.join(root, relative))));
});

test('invalid HTML deletion targets cannot trash files outside the project', async (t) => {
  const root = await fixture(t);
  for (const relativePath of [
    '../outside.html',
    'output/games/v1/../../index.html',
    'output/games/v1',
  ])
    assert.throws(
      () =>
        reduceCollaboration({}, 'documents:delete', {
          documentId: relativePath,
          relativePath,
        }),
      /경로/,
    );
  let trashed = false;
  await assert.rejects(
    trashDeletedFiles(root, { '../outside.md': 'outside' }, {}, async () => {
      trashed = true;
    }),
    /프로젝트 밖/,
  );
  assert.equal(trashed, false);
});
