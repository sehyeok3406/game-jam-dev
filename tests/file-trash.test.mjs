import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import matter from 'gray-matter';
import { filesystemFileTrash } from '../src/adapters/filesystem/file-trash.ts';
import { filesystemCommandPublisher } from '../src/adapters/filesystem/command-publisher.ts';
import { filesystemProjectRepository } from '../src/adapters/filesystem/local-project-repository.ts';
import {
  LocalCommandService,
  snapshotChanges,
} from '../src/application/editing/command-service.ts';
import { FileTrashService } from '../src/application/editing/file-trash-service.ts';
import { localHistoryInverse } from '../src/application/editing/edit-history-service.ts';
import { TRASH_RETENTION } from '../src/contracts/file-trash.ts';

const project = { id: 'local:test', name: '이미지 파일 검사' };
const imagePath = 'assets/images/sprite.png';
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAwAAAAECAYAAAC6Jt6KAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAUSURBVBhXY2AgB8hN+P+fWEx7DQBvzVgtcyg/0wAAAABJRU5ErkJggg==';
const image = `data:image/png;base64,${png}`;
const imageDocument = (id) =>
  matter.stringify(`![이미지](../${imagePath})\n`, {
    id,
    title: id,
    type: 'image',
    x: 120,
    y: 120,
    width: 180,
    height: 160,
    asset: {
      path: imagePath,
      purpose: 'asset',
      originalName: 'sprite.png',
      mime: 'image/png',
      bytes: Buffer.from(png, 'base64').length,
    },
  });

async function fixture(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-file-trash-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await fs.rm(root, { recursive: true, force: true });
  });
  const repository = filesystemProjectRepository(root);
  let now = Date.now();
  const clock = { now: () => now, id: randomUUID };
  const reopen = () =>
    new FileTrashService(filesystemFileTrash(root), repository, clock);
  const recycle = [];
  const service = reopen();
  const command = new LocalCommandService(
    repository,
    clock,
    filesystemCommandPublisher(
      root,
      repository,
      {
        pauseWatcher: async () => async () => {},
        trashItem: async (target) => {
          recycle.push(target);
          await fs.rename(target, `${target}.recycled`);
        },
      },
      service,
    ),
  );
  await repository.apply({}, files);
  return {
    root,
    repository,
    command,
    service,
    reopen,
    recycle,
    advance: (elapsed) => (now += elapsed),
  };
}

test('last image reference moves the original and either image card can restore it after restart', async (t) => {
  const f = await fixture(t, {
    [imagePath]: image,
    'docs/a.md': imageDocument('a'),
    'docs/b.md': imageDocument('b'),
  });
  await f.command.execute('documents:delete', {
    documentId: 'a',
    relativePath: 'docs/a.md',
  });
  assert.equal((await f.repository.capture())[imagePath], image);
  const [first] = await f.service.list(project);
  await f.command.execute('documents:delete-many', {
    documents: [{ documentId: 'b', relativePath: 'docs/b.md' }],
  });
  await assert.rejects(fs.access(path.join(f.root, imagePath)), {
    code: 'ENOENT',
  });
  const reopened = f.reopen();
  const second = (await reopened.list(project)).find(
    ({ id }) => id !== first.id,
  );
  await reopened.restore(first.id);
  assert.equal((await f.repository.capture())['docs/a.md'], imageDocument('a'));
  assert.deepEqual(
    await fs.readFile(path.join(f.root, imagePath)),
    Buffer.from(png, 'base64'),
  );
  await reopened.restore(second.id);
  assert.equal((await f.repository.capture())['docs/b.md'], imageDocument('b'));
  assert.deepEqual(await reopened.list(project), []);
  assert.deepEqual(f.recycle, []);
});

test('surviving Markdown and HTML links keep original image bytes', async (t) => {
  const f = await fixture(t, {
    [imagePath]: image,
    'docs/a.md': imageDocument('a'),
    'docs/link.md': `[원본](../${imagePath})\n`,
    'output/index.html':
      '<!doctype html><img src="../assets/images/sprite.png">',
  });
  await f.command.execute('documents:delete', {
    documentId: 'a',
    relativePath: 'docs/a.md',
  });
  assert.equal((await f.repository.capture())[imagePath], image);
});

test('file trash rejects replacement paths and expires only its own backup', async (t) => {
  const f = await fixture(t, {
    [imagePath]: image,
    'docs/a.md': imageDocument('a'),
  });
  await f.command.execute('documents:delete', {
    documentId: 'a',
    relativePath: 'docs/a.md',
  });
  const [entry] = await f.service.list(project);
  const replacement = '# 새 파일\n';
  await f.repository.apply(await f.repository.capture(), {
    'docs/a.md': replacement,
  });
  await assert.rejects(f.service.restore(entry.id), /충돌/);
  await assert.rejects(f.service.purge(entry.id, false), /확인/);
  assert.equal((await f.service.list(project)).length, 1);
  f.advance(TRASH_RETENTION);
  const service = f.reopen();
  await assert.rejects(service.restore(entry.id), /기간/);
  await service.maintain();
  assert.deepEqual(await filesystemFileTrash(f.root).list(), []);
  assert.equal((await f.repository.capture())['docs/a.md'], replacement);
});

test('undo and redo reflect in the bin, and restore recovers the original section membership', async (t) => {
  const section = matter.stringify('# 섹션 본문\n', {
    id: 's',
    title: '섹션',
    type: 'section',
    x: 10,
    y: 10,
    width: 500,
    height: 500,
    members: [{ id: 'a', path: 'docs/a.md' }],
  });
  const f = await fixture(t, {
    [imagePath]: image,
    'docs/a.md': imageDocument('a'),
    'sections/s.md': section,
  });
  const before = await f.repository.capture();
  await f.command.execute('documents:delete', {
    documentId: 'a',
    relativePath: 'docs/a.md',
  });
  const after = await f.repository.capture();
  const [entry] = await f.service.list(project);
  const undone = localHistoryInverse(after, before, after, 'undo');
  await f.repository.apply(after, snapshotChanges(after, undone));
  assert.deepEqual(await f.service.list(project), []);
  assert.throws(
    () =>
      localHistoryInverse(
        { ...undone, 'docs/added.md': `[원본](../${imagePath})\n` },
        before,
        after,
        'redo',
      ),
    /참조하는 이미지/,
  );
  const redone = localHistoryInverse(undone, before, after, 'redo');
  await f.repository.apply(undone, snapshotChanges(undone, redone));
  assert.equal((await f.service.list(project))[0].id, entry.id);
  await f.service.restore(entry.id);
  assert.deepEqual(await f.repository.capture(), before);
});

test('tracked HTML is restorable, while an untracked companion keeps the existing folder recycle path', async (t) => {
  const html = 'output/systems/test/v001/index.html';
  const content = '<!doctype html><title>파일 휴지통</title>';
  const f = await fixture(t, { [html]: content });
  const remove = () =>
    f.command.execute('documents:delete', {
      documentId: html,
      relativePath: html,
    });
  await remove();
  const [entry] = await f.service.list(project);
  assert.equal(entry.files[0].path, html);
  await f.service.restore(entry.id);
  assert.equal((await f.repository.capture())[html], content);
  const folder = path.dirname(path.join(f.root, html));
  await fs.mkdir(path.join(folder, 'untracked-empty'));
  await remove();
  assert.deepEqual(f.recycle, [folder]);
  assert.deepEqual(await f.service.list(project), []);
  assert.ok(
    (
      await fs.stat(path.join(`${folder}.recycled`, 'untracked-empty'))
    ).isDirectory(),
  );
});
