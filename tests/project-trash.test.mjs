import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ProjectLibrary } from '../src/project-library.ts';
import { ProjectTrash } from '../src/project-trash.ts';
import { TRASH_RETENTION } from '../src/trash-files.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => b.toString(),
};
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-trash-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const profile = path.join(base, 'profile'),
    root = path.join(base, 'game');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'project.md'), '# game');
  const library = new ProjectLibrary(profile, encryption);
  await library.load();
  await library.rememberLocal(root, 'game');
  const seen = [];
  const hooks = {
    capture: async () => ({ draft: 'unsent' }),
    remove: async () => seen.push('remove'),
    restore: async () => seen.push('restore'),
  };
  const trash = new ProjectTrash(profile, library, encryption, hooks);
  const id = library.list()[0].id;
  return { base, profile, root, library, trash, id, seen, hooks };
}
test('local trash moves the entire tree, survives restart and restores files and folder membership', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.root, '.git'));
  await fs.writeFile(
    path.join(f.root, '.git', 'unknown.bin'),
    'untracked bytes',
  );
  await f.library.createFolder('folder');
  const folder = f.library.listFolders()[0];
  await f.library.moveProject(f.id, folder.id);
  await fs.writeFile(
    path.join(f.profile, 'local-projects.json'),
    JSON.stringify(f.library.list()),
  );
  const plan = await f.trash.prepare(f.id),
    key = `game-canvas-draft:${f.root}:memo`;
  const id = await f.trash.trash(plan.token, { [key]: 'draft' });
  assert.equal(await fs.stat(f.root).catch(() => null), null);
  assert.equal(f.library.list().length, 0);
  const item = f.trash.list()[0];
  assert.equal(item.expiresAt - item.trashedAt, TRASH_RETENTION);
  const library = new ProjectLibrary(f.profile, encryption);
  await library.load();
  assert.equal(library.list().length, 0);
  const restarted = new ProjectTrash(f.profile, library, encryption, f.hooks);
  await restarted.load();
  await restarted.maintain();
  assert.deepEqual(await restarted.restore(id), { [key]: 'draft' });
  await restarted.acknowledgeRestore(id);
  assert.equal(
    await fs.readFile(path.join(f.root, '.git', 'unknown.bin'), 'utf8'),
    'untracked bytes',
  );
  assert.equal(library.list()[0].folderId, folder.id);
  assert.equal(restarted.list().length, 0);
});
test('restore refuses a replacement folder and keeps retained files', async (t) => {
  const f = await fixture(t);
  const p = await f.trash.prepare(f.id);
  const id = await f.trash.trash(p.token, {});
  await fs.mkdir(f.root);
  await fs.writeFile(path.join(f.root, 'sentinel'), 'keep');
  await assert.rejects(f.trash.restore(id), /다른 폴더/);
  assert.equal(
    await fs.readFile(path.join(f.root, 'sentinel'), 'utf8'),
    'keep',
  );
  await fs.rm(f.root, { recursive: true });
  await f.trash.restore(id);
  await f.trash.acknowledgeRestore(id);
  assert.equal(
    await fs.readFile(path.join(f.root, 'project.md'), 'utf8'),
    '# game',
  );
});
test('permanent purge requires confirmation and preserves internal junction targets', async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.base, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'sentinel'), 'keep');
  await fs.symlink(
    outside,
    path.join(f.root, 'link'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const p = await f.trash.prepare(f.id),
    id = await f.trash.trash(p.token, {});
  await assert.rejects(f.trash.purge(id, 'wrong', true), /확인/);
  await f.trash.purge(id, 'game', true);
  assert.equal(f.trash.list().length, 0);
  assert.equal(
    await fs.readFile(path.join(outside, 'sentinel'), 'utf8'),
    'keep',
  );
});
test('deadline purge after restart never touches a recreated original folder', async (t) => {
  const f = await fixture(t);
  const p = await f.trash.prepare(f.id),
    id = await f.trash.trash(p.token, {});
  const file = path.join(f.profile, 'project-trash', id + '.json');
  const encoded = JSON.parse(await fs.readFile(file, 'utf8'));
  const record = JSON.parse(Buffer.from(encoded.encrypted, 'base64'));
  record.expiresAt = 0;
  encoded.encrypted = Buffer.from(JSON.stringify(record)).toString('base64');
  await fs.writeFile(file, JSON.stringify(encoded));
  await fs.mkdir(f.root);
  await fs.writeFile(path.join(f.root, 'new'), 'new');
  const restarted = new ProjectTrash(f.profile, f.library, encryption, f.hooks);
  await restarted.load();
  await restarted.maintain();
  assert.equal(restarted.list().length, 0);
  assert.equal(await fs.readFile(path.join(f.root, 'new'), 'utf8'), 'new');
});
test('protected, nested, and root junction projects cannot be moved', async (t) => {
  const f = await fixture(t);
  const protectedTrash = new ProjectTrash(
    f.profile,
    f.library,
    encryption,
    f.hooks,
    [f.root],
  );
  await assert.rejects(protectedTrash.prepare(f.id), /보호/);
  await fs.mkdir(path.join(f.root, 'child'));
  await f.library.rememberLocal(path.join(f.root, 'child'), 'child');
  await assert.rejects(f.trash.prepare(f.id), /중첩/);
  const link = path.join(f.base, 'junction');
  await fs.symlink(
    f.root,
    link,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await f.library.rememberLocal(link, 'linked');
  await assert.rejects(
    f.trash.prepare(f.library.list().find((p) => p.name === 'linked').id),
    /junction/,
  );
});
test('shared local trash retains original local project and protects credentials', async (t) => {
  const f = await fixture(t),
    uuid = crypto.randomUUID(),
    cache = path.join(f.profile, 'shared-workspaces', uuid);
  await fs.mkdir(cache, { recursive: true });
  await fs.writeFile(path.join(cache, 'server-cache.json'), 'offline');
  await f.library.rememberShared(
    {
      serverUrl: 'http://localhost:4317',
      projectId: uuid,
      token: 'secret-token',
    },
    'shared',
    'admin',
    f.root,
  );
  const p = await f.trash.prepare('shared:' + uuid),
    id = await f.trash.trash(p.token, {});
  assert.equal(
    await fs.readFile(path.join(f.root, 'project.md'), 'utf8'),
    '# game',
  );
  assert.ok(!JSON.stringify(f.trash.list()).includes('secret-token'));
  await f.trash.restore(id);
  await f.trash.acknowledgeRestore(id);
  assert.equal(
    f.library.get('shared:' + uuid).credentials.token,
    'secret-token',
  );
});
async function serverFixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-server-trash-'));
  let server = await createCollaborationServer({ dataDirectory: dir, port: 0 });
  t.after(async () => {
    owner.stop();
    editor.stop();
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  let url = `http://127.0.0.1:${server.port}`;
  const created = await CollaborationClient.create(url, '', 'owner', 'team', {
    'project.md': '# game',
  });
  const joined = await CollaborationClient.join(
    url,
    created.credentials.inviteCode,
    'editor',
  );
  const owner = new CollaborationClient(created.credentials, () => {}),
    editor = new CollaborationClient(joined.credentials, () => {});
  owner.accept(created.result);
  editor.accept(joined.result);
  const request = (client, action, input = {}) =>
    CollaborationClient.fetch(
      url,
      `/projects/${client.credentials.projectId}/${action}`,
      input,
      client.credentials.token,
    );
  return {
    dir,
    owner,
    editor,
    request,
    restart: async () => {
      await server.close();
      server = await createCollaborationServer({ dataDirectory: dir, port: 0 });
      url = `http://127.0.0.1:${server.port}`;
      owner.credentials.serverUrl = url;
      editor.credentials.serverUrl = url;
    },
  };
}
test('team trash is admin-only, blocks online/offline writes, restores and requires resuming pending work', async (t) => {
  const f = await serverFixture(t);
  await assert.rejects(
    f.request(f.editor, 'trash', {
      typedName: 'team',
      confirmTeam: true,
      expectedVersion: 0,
    }),
    /관리자/,
  );
  const offline = {
    base: { ...f.editor.files },
    local: { ...f.editor.files, 'project.md': '# unsent' },
  };
  f.editor.offline = offline;
  f.editor.files = offline.local;
  const status = await f.request(f.owner, 'trash', {
    typedName: 'team',
    confirmTeam: true,
    expectedVersion: 0,
  });
  assert.equal(status.status, 'trashed');
  assert.equal(status.expiresAt - Date.now() > TRASH_RETENTION - 5000, true);
  await assert.rejects(f.editor.refresh(), (e) => e.code === 'PROJECT_TRASHED');
  assert.equal(f.editor.state.projectDeleted, true);
  assert.equal(f.editor.files['project.md'], '# unsent');
  await assert.rejects(
    f.request(f.editor, 'command', { channel: 'documents:save' }),
    (e) => e.code === 'PROJECT_TRASHED',
  );
  await f.restart();
  assert.equal((await f.request(f.owner, 'lifecycle')).status, 'trashed');
  await f.request(f.owner, 'trash-restore');
  await f.editor.refresh();
  assert.equal(f.editor.state.awaitingResume, true);
  assert.equal(f.editor.files['project.md'], '# unsent');
  await assert.rejects(
    f.request(f.editor, 'invite'),
    (e) => e.code === 'PROJECT_LIFECYCLE_CHANGED',
  );
  await f.owner.refresh();
  assert.equal(f.owner.state.connected, true);
});
test('server purge removes content and tombstones prevent checkpoint resurrection; shared blobs survive', async (t) => {
  const f = await serverFixture(t);
  const other = await CollaborationClient.create(
    f.owner.credentials.serverUrl,
    '',
    'other',
    'other',
    { 'project.md': '# game' },
  );
  const id = f.owner.credentials.projectId;
  await f.request(f.owner, 'trash', {
    typedName: 'team',
    confirmTeam: true,
    expectedVersion: 0,
  });
  await f.request(f.owner, 'trash-purge', { typedName: 'team' });
  await assert.rejects(
    f.request(f.owner, 'state'),
    (e) => e.code === 'PROJECT_PURGED',
  );
  const db = new DatabaseSync(path.join(f.dir, 'sync.sqlite'));
  assert.equal(
    db.prepare('SELECT count(*) AS n FROM projects WHERE id=?').get(id).n,
    0,
  );
  assert.equal(db.prepare('SELECT count(*) AS n FROM blobs').get().n, 1);
  db.close();
  await fs.mkdir(path.join(f.dir, id), { recursive: true });
  await fs.writeFile(
    path.join(f.dir, id, 'head.json'),
    'invalid stale checkpoint',
  );
  await f.restart();
  await assert.rejects(
    f.request(f.owner, 'state'),
    (e) => e.code === 'PROJECT_PURGED',
  );
  const remaining = await CollaborationClient.fetch(
    f.owner.credentials.serverUrl,
    `/projects/${other.credentials.projectId}/state`,
    {},
    other.credentials.token,
  );
  assert.equal(remaining.files['project.md'], '# game');
});
test('expired server trash is deleted on next server start', async (t) => {
  const f = await serverFixture(t);
  const id = f.owner.credentials.projectId;
  await f.request(f.owner, 'trash', {
    typedName: 'team',
    confirmTeam: true,
    expectedVersion: 0,
  });
  const db = new DatabaseSync(path.join(f.dir, 'sync.sqlite'));
  const row = JSON.parse(
    db.prepare('SELECT value FROM projects WHERE id=?').get(id).value,
  );
  row.lifecycle.expiresAt = 0;
  db.prepare('UPDATE projects SET value=? WHERE id=?').run(
    JSON.stringify(row),
    id,
  );
  db.close();
  await f.restart();
  await assert.rejects(
    f.request(f.owner, 'state'),
    (e) => e.code === 'PROJECT_PURGED',
  );
});

test('failed cleanup retains a durable bundle and restart completes the move without data loss', async (t) => {
  const f = await fixture(t);
  let fail = true;
  const hooks = {
    ...f.hooks,
    remove: async () => {
      if (fail) throw Error('injected registry failure');
    },
  };
  const trash = new ProjectTrash(f.profile, f.library, encryption, hooks);
  const p = await trash.prepare(f.id);
  await assert.rejects(trash.trash(p.token, {}), /injected/);
  assert.equal(trash.list()[0].stage, 'moving');
  assert.equal(await fs.stat(f.root).catch(() => null), null);
  fail = false;
  const restarted = new ProjectTrash(f.profile, f.library, encryption, hooks);
  await restarted.load();
  await restarted.maintain();
  assert.equal(restarted.list()[0].stage, 'retained');
  assert.equal(f.library.list().length, 0);
  await restarted.restore(restarted.list()[0].trashId);
  assert.equal(
    await fs.readFile(path.join(f.root, 'project.md'), 'utf8'),
    '# game',
  );
});
test('consumed move token cannot delete the project again after restoration', async (t) => {
  const f = await fixture(t),
    p = await f.trash.prepare(f.id);
  const id = await f.trash.trash(p.token, {});
  await f.trash.restore(id);
  await f.trash.acknowledgeRestore(id);
  assert.equal(await f.trash.trash(p.token, {}), id);
  assert.ok(await fs.stat(f.root));
  assert.equal(f.trash.list().length, 0);
});
test('owner recovery during retention rotates management access without exposing server files', async (t) => {
  const f = await serverFixture(t);
  await f.request(f.owner, 'trash', {
    typedName: 'team',
    confirmTeam: true,
    expectedVersion: 0,
  });
  const recovered = await CollaborationClient.recover(
    f.owner.credentials.serverUrl,
    f.owner.credentials.projectId,
    f.owner.credentials.recoveryKey,
  );
  assert.deepEqual(recovered.result.files, {});
  assert.equal(recovered.result.state.projectDeleted, true);
  const status = await CollaborationClient.fetch(
    recovered.credentials.serverUrl,
    `/projects/${recovered.credentials.projectId}/trash-restore`,
    {},
    recovered.credentials.token,
  );
  assert.equal(status.status, 'active');
});

test('local restore rejects a name now used by another project before moving files or invoking hooks', async (t) => {
  const f = await fixture(t);
  const plan = await f.trash.prepare(f.id);
  const id = await f.trash.trash(plan.token, {});
  await f.library.rememberLocal(path.join(f.base, 'other'), 'GAME');
  await assert.rejects(f.trash.restore(id), /같은 이름/);
  assert.equal(await fs.stat(f.root).catch(() => null), null);
  assert.ok(!f.seen.includes('restore'));
  assert.equal(f.trash.list().length, 1);
  await f.library.renameProject(f.library.list()[0].id, 'other');
  await f.trash.restore(id);
  assert.equal(
    await fs.readFile(path.join(f.root, 'project.md'), 'utf8'),
    '# game',
  );
});
