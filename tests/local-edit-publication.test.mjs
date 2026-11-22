import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { prepareLocalEditPublication } from '../src/adapters/filesystem/local-edit-publication.ts';
import { filesystemProjectRepository } from '../src/adapters/filesystem/local-project-repository.ts';
import { listHistory } from '../src/project-store.ts';

const first = 'ideas/first.md';
const second = 'ideas/second.md';
const before = { [first]: '# first\n', [second]: '# second\n' };
const after = { [first]: '# edited first\n', [second]: '# edited second\n' };
const external = '# external edit\n';

async function fixture(t) {
  const temporary = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(temporary, 'gamejam-local-publish-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), temporary);
    await fs.rm(root, { recursive: true, force: true });
  });
  const firstPath = path.join(root, first);
  const secondPath = path.join(root, second);
  await fs.mkdir(path.dirname(firstPath), { recursive: true });
  await fs.writeFile(firstPath, before[first]);
  await fs.writeFile(secondPath, before[second]);
  const meta = {
    id: randomUUID(),
    label: '편집 내용 저장',
    kind: 'user',
    status: 'completed',
    createdAt: 1,
  };
  const prepare = (baseline = before) =>
    prepareLocalEditPublication(root, baseline, after, meta, () => {});
  const read = (file) => fs.readFile(file, 'utf8');
  return { root, meta, firstPath, secondPath, prepare, read };
}

test('restart finalizes a fully written batch once using its staged history', async (t) => {
  const f = await fixture(t);
  const pending = await f.prepare();
  await pending.apply();
  assert.deepEqual(await listHistory(f.root), []);
  await filesystemProjectRepository(f.root).recover();
  await filesystemProjectRepository(f.root).recover();
  assert.equal(await f.read(f.firstPath), after[first]);
  assert.equal(await f.read(f.secondPath), after[second]);
  assert.deepEqual(
    (await listHistory(f.root)).map((entry) => entry.id),
    [f.meta.id],
  );
});

test('external edit during replacement survives rollback and a retry creates one version', async (t) => {
  const f = await fixture(t);
  const pending = await f.prepare();
  const write = fs.writeFile.bind(fs);
  const hook = t.mock.method(fs, 'writeFile', async (filename, ...args) => {
    const result = await write(filename, ...args);
    if (typeof filename === 'string' && filename.startsWith(f.secondPath + '.'))
      await write(f.secondPath, external);
    return result;
  });
  await assert.rejects(pending.apply(), /외부 변경/);
  hook.mock.restore();
  assert.equal(await f.read(f.firstPath), before[first]);
  assert.equal(await f.read(f.secondPath), external);
  assert.deepEqual(await listHistory(f.root), []);
  const retry = await f.prepare({ ...before, [second]: external });
  await retry.apply();
  await retry.finish();
  assert.equal(await f.read(f.secondPath), after[second]);
  assert.deepEqual(
    (await listHistory(f.root)).map((entry) => entry.id),
    [f.meta.id],
  );
});
