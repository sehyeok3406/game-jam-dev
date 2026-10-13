import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyChanges } from '../src/project-store.ts';
const windows = process.platform === 'win32';
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-write-retry-'));
  const absolute = path.join(root, 'project.md');
  await fs.writeFile(absolute, '# original');
  const originalRename = fs.rename;
  t.after(async () => {
    fs.rename = originalRename;
    assert.ok(
      path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep),
    );
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, absolute, originalRename };
}
test(
  'Windows atomic project write survives brief sharing violations without deleting the destination',
  { skip: !windows },
  async (t) => {
    const { root, absolute, originalRename } = await fixture(t);
    let attempts = 0;
    fs.rename = async (from, to) => {
      if (to === absolute && attempts++ < 2)
        throw Object.assign(new Error('sharing violation'), { code: 'EPERM' });
      return originalRename(from, to);
    };
    await applyChanges(
      root,
      { 'project.md': '# original' },
      { 'project.md': '# updated' },
    );
    assert.equal(attempts, 3);
    assert.equal(await fs.readFile(absolute, 'utf8'), '# updated');
    assert.deepEqual(await fs.readdir(root), ['project.md']);
  },
);
test(
  'Windows sharing-violation retry refuses an external edit and cleans its temporary file',
  { skip: !windows },
  async (t) => {
    const { root, absolute, originalRename } = await fixture(t);
    let attempts = 0;
    fs.rename = async (from, to) => {
      if (to === absolute && attempts++ === 0) {
        await fs.writeFile(absolute, '# external');
        throw Object.assign(new Error('sharing violation'), { code: 'EPERM' });
      }
      return originalRename(from, to);
    };
    await assert.rejects(
      applyChanges(
        root,
        { 'project.md': '# original' },
        { 'project.md': '# updated' },
      ),
      /외부 변경/,
    );
    assert.equal(attempts, 1);
    assert.equal(await fs.readFile(absolute, 'utf8'), '# external');
    assert.deepEqual(await fs.readdir(root), ['project.md']);
  },
);
