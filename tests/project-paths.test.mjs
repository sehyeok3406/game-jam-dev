import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DesktopProjectPaths } from '../src/desktop/project-paths.ts';

async function setup(t, guard = () => {}) {
  const base = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-project-paths-'),
  );
  t.after(async () => {
    assert.ok(
      path.resolve(base).startsWith(path.resolve(os.tmpdir()) + path.sep),
    );
    await fs.unlink(path.join(base, 'project', 'escape')).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await fs.rm(base, { recursive: true, force: true });
  });
  const root = path.join(base, 'project'),
    outside = path.join(base, 'outside');
  await fs.mkdir(path.join(root, 'output'), { recursive: true });
  await fs.mkdir(outside);
  await fs.writeFile(path.join(root, 'output/index.html'), '<html>한글</html>');
  await fs.writeFile(path.join(outside, 'secret.md'), 'outside');
  const calls = [];
  const paths = new DesktopProjectPaths(root, guard, {
    reveal: (p) => calls.push(['reveal', p]),
    open: async (p) => {
      calls.push(['open', p]);
    },
  });
  return { root, outside, calls, paths };
}
test('native project paths read previews and resolve file/folder opens only inside the captured root', async (t) => {
  const { root, paths, calls } = await setup(t);
  assert.equal(
    await paths.readPreview('output/index.html'),
    '<html>한글</html>',
  );
  assert.equal(await paths.readPreview('project.md'), undefined);
  assert.equal(await paths.readPreview('output/versions/v1.html'), undefined);
  await paths.reveal('output/index.html');
  await paths.open();
  assert.deepEqual(calls, [
    ['reveal', path.join(root, 'output/index.html')],
    ['open', root],
  ]);
});
test('traversal and symlink/junction targets cannot reach native shell or preview reads', async (t) => {
  const { root, outside, paths, calls } = await setup(t);
  await assert.rejects(paths.reveal('../outside/secret.md'), /밖/);
  await assert.rejects(paths.reveal(path.join(outside, 'secret.md')), /밖/);
  await fs.symlink(
    outside,
    path.join(root, 'escape'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(paths.reveal('escape/secret.md'), /심볼릭/);
  assert.equal(
    await paths.readPreview('output/../escape/secret.md'),
    undefined,
  );
  assert.deepEqual(calls, []);
});
test('session changes during native resolution/read prevent shell use or stale content return', async (t) => {
  let checks = 0,
    failAt = Infinity;
  const { paths, calls } = await setup(t, () => {
    if (++checks >= failAt) throw Error('session changed');
  });
  failAt = 2;
  await assert.rejects(paths.reveal('output/index.html'), /session changed/);
  checks = 0;
  failAt = 3;
  assert.equal(await paths.readPreview('output/index.html'), undefined);
  checks = 0;
  failAt = 1;
  await assert.rejects(paths.open(), /session changed/);
  await assert.rejects(
    paths.authorship('output/index.html'),
    /session changed/,
  );
  assert.deepEqual(calls, []);
});
