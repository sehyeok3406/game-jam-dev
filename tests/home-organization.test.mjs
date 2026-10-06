import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProjectLibrary } from '../src/project-library.ts';
import { homeName, readHomeOrganization } from '../src/home-organization.ts';

const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value).map((byte) => byte ^ 99),
  decryptString: (value) =>
    Buffer.from(value)
      .map((byte) => byte ^ 99)
      .toString(),
};
async function fixture(t, secure = encryption) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-home-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const library = new ProjectLibrary(path.join(directory, 'registry'), secure);
  await library.load();
  const root = path.join(directory, 'original-game');
  await fs.mkdir(root);
  await fs.writeFile(
    path.join(root, 'project.md'),
    '# 원래 프로젝트\n기획 원본',
  );
  await library.rememberLocal(root, 'GameJam_Test');
  const localId = library.list()[0].id;
  return { directory, library, root, localId, secure };
}

test('local/shared registry name refresh preserves independent IDs, folder grouping, credentials and roles', async (t) => {
  const { directory, library, root, localId } = await fixture(t);
  const credentials = {
    projectId: 'shared-test-id',
    serverUrl: 'https://fixture.example',
    token: 'private-token-fixture',
  };
  await library.rememberShared(credentials, 'GameJam_Test', 'viewer', root);
  const sharedId = 'shared:shared-test-id';
  await library.renameProject(localId, '내 로컬 기획');
  await library.renameProject(sharedId, '팀 작업');
  await library.createFolder('진행 중');
  const folder = library.listFolders()[0];
  await library.moveProject(localId, folder.id);
  await library.moveProject(sharedId, folder.id);
  const metadata = await fs.readFile(
    path.join(directory, 'registry/home-organization.json'),
    'utf8',
  );
  assert.ok(!metadata.includes('private-token-fixture'));
  assert.ok(!metadata.includes('serverUrl'));
  assert.equal(
    await fs.readFile(path.join(root, 'project.md'), 'utf8'),
    '# 원래 프로젝트\n기획 원본',
  );
  await library.rememberLocal(root, '내 로컬 기획');
  await library.rememberShared(credentials, '팀 작업', 'viewer', root);
  const fresh = new ProjectLibrary(
    path.join(directory, 'registry'),
    encryption,
  );
  await fresh.load();
  assert.equal(
    fresh.list().find((entry) => entry.id === localId).name,
    '내 로컬 기획',
  );
  assert.equal(
    fresh.list().find((entry) => entry.id === sharedId).name,
    '팀 작업',
  );
  assert.ok(fresh.list().every((entry) => entry.folderId === folder.id));
  assert.equal(fresh.get(sharedId).name, '팀 작업');
  assert.equal(fresh.get(sharedId).role, 'viewer');
  assert.deepEqual(fresh.get(sharedId).credentials, credentials);
  assert.ok(!JSON.stringify(fresh.list()).includes('private-token-fixture'));
});

test('folder rename, move back to unfiled and delete only affect home grouping, including empty folders', async (t) => {
  const { directory, library, localId } = await fixture(t);
  await library.createFolder('진행');
  await library.createFolder('완료');
  const [first, second] = library.listFolders();
  await library.moveProject(localId, first.id);
  await library.renameFolder(first.id, '진행 중');
  await library.moveProject(localId, second.id);
  await library.removeFolder(first.id);
  assert.equal(library.list()[0].folderId, second.id);
  await library.moveProject(localId, null);
  assert.equal(library.list()[0].folderId, undefined);
  await library.moveProject(localId, second.id);
  await library.removeFolder(second.id);
  assert.equal(library.list().length, 1);
  assert.equal(library.list()[0].folderId, undefined);
  const fresh = new ProjectLibrary(
    path.join(directory, 'registry'),
    encryption,
  );
  await fresh.load();
  assert.deepEqual(fresh.listFolders(), []);
  assert.equal(fresh.list()[0].folderId, undefined);
});

test('invalid/duplicate names and unknown project/folder IDs fail without changing home data', async (t) => {
  const { library, localId } = await fixture(t);
  await library.createFolder('Games');
  for (const name of ['', '  ', 'x'.repeat(101), '이름\n줄바꿈']) {
    await assert.rejects(library.createFolder(name), /이름/);
    await assert.rejects(library.renameProject(localId, name), /이름/);
  }
  await assert.rejects(library.createFolder('games'), /이미/);
  await assert.rejects(library.moveProject(localId, 'missing'), /폴더/);
  await assert.rejects(library.renameProject('missing', '이름'), /프로젝트/);
  await assert.rejects(library.renameFolder('missing', '이름'), /폴더/);
  await assert.rejects(library.removeFolder('missing'), /폴더/);
  assert.equal(library.listFolders().length, 1);
  assert.equal(library.list()[0].folderId, undefined);
  assert.equal(library.list()[0].name, 'GameJam_Test');
  assert.equal(homeName(' 게임 / 테스트 '), '게임 / 테스트');
});

test('home writes are serialized and failed atomic writes do not acknowledge or retain changes', async (t) => {
  const { directory, library, localId } = await fixture(t);
  await Promise.all([
    library.createFolder('A'),
    library.createFolder('B'),
    library.renameProject(localId, 'Alias'),
  ]);
  assert.equal(library.listFolders().length, 2);
  const target = path.join(directory, 'registry/home-organization.json');
  await fs.rename(target, `${target}.backup`);
  await fs.mkdir(target);
  await assert.rejects(
    library.renameFolder(library.listFolders()[0].id, 'Unsaved'),
  );
  await assert.rejects(library.removeFolder(library.listFolders()[0].id));
  assert.equal(library.list()[0].name, 'Alias');
  assert.equal(library.listFolders().length, 2);
  assert.ok(
    !(await fs.readdir(path.dirname(target))).some((name) =>
      name.endsWith('.tmp'),
    ),
  );
  await fs.rmdir(target);
  await library.renameProject(localId, 'Recovered');
  assert.equal(library.list()[0].name, 'Recovered');
});

test('home organization remains usable without OS encryption and old project registries load unchanged', async (t) => {
  const unavailable = { ...encryption, isEncryptionAvailable: () => false };
  const { directory, library, root, localId } = await fixture(t, unavailable);
  await library.renameProject(localId, '오프라인 로컬');
  await library.createFolder('로컬');
  await library.moveProject(localId, library.listFolders()[0].id);
  const fresh = new ProjectLibrary(
    path.join(directory, 'registry'),
    unavailable,
  );
  await fresh.load();
  assert.equal(fresh.list()[0].name, '오프라인 로컬');
  assert.equal(fresh.get(localId).root, root);
  assert.deepEqual(
    (await fs.readdir(path.join(directory, 'registry'))).sort(),
    ['home-organization.json', 'local-projects.json'],
  );
});

test('failed registry name writes retain the last acknowledged name and credentials and recover cleanly', async (t) => {
  const { directory, library, localId } = await fixture(t);
  const target = path.join(directory, 'registry/projects.enc');
  const original = await fs.readFile(target);
  await fs.rename(target, `${target}.backup`);
  await fs.mkdir(target);
  await assert.rejects(library.renameProject(localId, 'Not saved'));
  assert.equal(library.list()[0].name, 'GameJam_Test');
  assert.deepEqual(await fs.readFile(`${target}.backup`), original);
  assert.ok(
    !(await fs.readdir(path.dirname(target))).some((name) =>
      name.endsWith('.tmp'),
    ),
  );
  await fs.rmdir(target);
  await library.renameProject(localId, 'Saved name');
  const fresh = new ProjectLibrary(path.dirname(target), encryption);
  await fresh.load();
  assert.equal(fresh.get(localId).name, 'Saved name');
});

test('home storage parser rejects broken groups and excludes unexpected private fields', () => {
  assert.throws(() => readHomeOrganization('{'), /JSON|property/i);
  assert.throws(
    () =>
      readHomeOrganization(
        JSON.stringify({
          folders: [],
          projects: [{ id: 'p', folderId: 'missing' }],
        }),
      ),
    /폴더/,
  );
  const parsed = readHomeOrganization(
    JSON.stringify({
      folders: [{ id: 'f', name: '그룹', token: 'private' }],
      projects: [
        {
          id: 'p',
          name: '별명',
          folderId: 'f',
          credentials: { token: 'private' },
        },
      ],
    }),
  );
  assert.ok(!JSON.stringify(parsed).includes('private'));
});
