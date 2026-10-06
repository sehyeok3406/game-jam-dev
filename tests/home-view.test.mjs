import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  DEFAULT_HOME_VIEW,
  homeDate,
  readHomeView,
  selectHomeProjects,
} from '../src/home-view.ts';
import { localProjectTimestamps } from '../src/project-timestamps.ts';

const entries = [
  {
    id: 'l2',
    name: '게임 2',
    kind: 'local',
    root: 'C:/game2',
    folderId: 'folder',
    createdAt: 100,
    modifiedAt: 300,
    lastOpenedAt: 200,
  },
  {
    id: 's10',
    name: '게임 10',
    kind: 'shared',
    serverUrl: 'https://game.example',
    folderId: 'folder',
    createdAt: 200,
    modifiedAt: 100,
    lastOpenedAt: 300,
  },
  {
    id: 'l1',
    name: '게임 1',
    kind: 'local',
    createdAt: 300,
    modifiedAt: 200,
    lastOpenedAt: 100,
  },
  { id: 'unknown', name: '정보 없음', kind: 'shared', lastOpenedAt: 0 },
];
const ids = (view, query = '', folder = null) =>
  selectHomeProjects(
    entries,
    { ...DEFAULT_HOME_VIEW, ...view },
    query,
    folder,
  ).map((entry) => entry.id);

test('home supports natural Korean/numeric name order and reversible creation, modification and last-open order', () => {
  const before = structuredClone(entries);
  assert.deepEqual(ids({ sortBy: 'name', direction: 'asc' }), [
    'l1',
    'l2',
    's10',
    'unknown',
  ]);
  assert.deepEqual(ids({ sortBy: 'name', direction: 'desc' }), [
    'unknown',
    's10',
    'l2',
    'l1',
  ]);
  assert.deepEqual(ids({ sortBy: 'created' }), ['l1', 's10', 'l2', 'unknown']);
  assert.deepEqual(ids({ sortBy: 'created', direction: 'asc' }), [
    'l2',
    's10',
    'l1',
    'unknown',
  ]);
  assert.deepEqual(ids({ sortBy: 'modified' }), ['l2', 'l1', 's10', 'unknown']);
  assert.deepEqual(ids({ sortBy: 'modified', direction: 'asc' }), [
    's10',
    'l1',
    'l2',
    'unknown',
  ]);
  assert.deepEqual(ids({ sortBy: 'opened' }), ['s10', 'l2', 'l1', 'unknown']);
  assert.deepEqual(ids({ sortBy: 'opened', direction: 'asc' }), [
    'l1',
    'l2',
    's10',
    'unknown',
  ]);
  assert.deepEqual(entries, before);
});

test('type, selected folder and literal search combine without dropping folder membership or changing project data', () => {
  assert.deepEqual(ids({ filter: 'shared' }, '', 'folder'), ['s10']);
  assert.deepEqual(ids({ filter: 'local' }, 'GAME2', 'folder'), ['l2']);
  assert.deepEqual(ids({ filter: 'local' }, '  게임 2  ', 'folder'), ['l2']);
  assert.deepEqual(ids({ filter: 'local' }, '게임 10', 'folder'), []);
  assert.deepEqual(ids({ filter: 'all' }, 'game.example'), ['s10']);
});

test('view preferences round-trip and invalid/legacy storage values fall back to safe defaults, never private fields', () => {
  const settings = {
    filter: 'shared',
    sortBy: 'created',
    direction: 'asc',
    view: 'list',
  };
  assert.deepEqual(readHomeView(JSON.stringify(settings)), settings);
  for (const raw of [null, '{', 'null', '42', '{}'])
    assert.deepEqual(readHomeView(raw), DEFAULT_HOME_VIEW);
  assert.deepEqual(
    readHomeView(
      '{"filter":"invalid","sortBy":"injected","view":"list","token":"secret"}',
    ),
    { ...DEFAULT_HOME_VIEW, view: 'list' },
  );
  assert.equal(homeDate({ modifiedAt: Infinity }, 'modified'), undefined);
  assert.equal(homeDate({ modifiedAt: 1e20 }, 'modified'), undefined);
  assert.equal(homeDate({ modifiedAt: -1 }, 'modified'), undefined);
});

test('ties and missing dates have deterministic order regardless of input order or direction', () => {
  const values = [
    {
      id: 'b',
      name: '같은 이름',
      kind: 'local',
      modifiedAt: 100,
      lastOpenedAt: 0,
    },
    {
      id: 'a',
      name: '같은 이름',
      kind: 'shared',
      modifiedAt: 100,
      lastOpenedAt: 0,
    },
    { id: 'c', name: '날짜 없음', kind: 'shared', lastOpenedAt: 0 },
  ];
  for (const direction of ['asc', 'desc']) {
    const view = { ...DEFAULT_HOME_VIEW, direction };
    assert.deepEqual(
      selectHomeProjects(values, view, '', null).map((entry) => entry.id),
      ['a', 'b', 'c'],
    );
    assert.deepEqual(
      selectHomeProjects([...values].reverse(), view, '', null).map(
        (entry) => entry.id,
      ),
      ['a', 'b', 'c'],
    );
  }
});

test('local dates reflect real files and deletions, not history backups or unsupported files, and do not mutate data', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-home-dates-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'ideas'));
  await fs.mkdir(path.join(root, '.history'));
  await fs.writeFile(path.join(root, 'project.md'), '# 프로젝트');
  await fs.writeFile(path.join(root, 'ideas/a.md'), '# 메모');
  await fs.writeFile(path.join(root, '.history/new.md'), '# 백업');
  await fs.writeFile(path.join(root, 'ideas/ignored.exe'), 'ignored');
  const old = new Date('2020-01-01'),
    edited = new Date('2024-01-01'),
    future = new Date('2030-01-01');
  for (const filename of ['project.md', 'ideas/a.md', 'ideas'])
    await fs.utimes(path.join(root, filename), old, old);
  await fs.utimes(path.join(root, 'ideas/a.md'), edited, edited);
  await fs.utimes(path.join(root, '.history/new.md'), future, future);
  await fs.utimes(path.join(root, 'ideas/ignored.exe'), future, future);
  const dates = await localProjectTimestamps(root);
  assert.equal(dates.modifiedAt, edited.getTime());
  assert.equal(
    await fs.readFile(path.join(root, 'project.md'), 'utf8'),
    '# 프로젝트',
  );
  await fs.unlink(path.join(root, 'ideas/a.md'));
  await fs.utimes(path.join(root, 'ideas'), future, future);
  assert.equal(
    (await localProjectTimestamps(root)).modifiedAt,
    future.getTime(),
  );
  assert.equal((await localProjectTimestamps(root)).createdAt, dates.createdAt);
});

test('local timestamp scanning never follows external directory links, including nested assets/AI parents', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'canvas-home-links-'),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'project'),
    outside = path.join(directory, 'outside');
  await fs.mkdir(root);
  await fs.mkdir(outside);
  await fs.mkdir(path.join(outside, 'tasks'));
  await fs.writeFile(path.join(root, 'project.md'), '# safe');
  await fs.writeFile(path.join(outside, 'tasks/out.md'), '# outside');
  const future = new Date('2030-01-01');
  await fs.utimes(path.join(outside, 'tasks/out.md'), future, future);
  await fs.symlink(
    outside,
    path.join(root, '.ai'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.ok((await localProjectTimestamps(root)).modifiedAt < future.getTime());
});
