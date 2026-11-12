import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import matter from '../src/markdown.ts';
import {
  checkSnapshot,
  reduceCollaboration,
  snapshotSections,
} from '../src/collaboration-model.ts';
import {
  sectionDeletionPaths,
  sectionTree,
} from '../src/core/editing/section-tree.ts';
import { filesystemCommandPublisher } from '../src/adapters/filesystem/command-publisher.ts';
import { filesystemProjectRepository } from '../src/adapters/filesystem/local-project-repository.ts';
import { invertEdit } from '../src/edit-journal.ts';
import { projectCopyBundle } from '../src/project-copy.ts';
import { materialize } from '../src/project-store.ts';
import { PROJECT_LAYOUT_PATH } from '../src/contracts/project-layout.ts';

const md = (data) => matter.stringify('사용자 본문', data);
const parentPath = 'sections/parent.md';
const childPath = 'sections/child.md';
const leafPath = 'sections/leaf.md';
const notePath = 'docs/note.md';
const frame = { x: 0, y: 0, width: 420, height: 280 };
const fixture = () => ({
  [parentPath]: md({
    ...frame,
    id: 'parent',
    title: '상위',
    members: [],
    custom: '유지',
  }),
  [childPath]: md({
    ...frame,
    x: 48,
    y: 72,
    id: 'child',
    title: '하위',
    members: [],
    parent_section_id: 'parent',
  }),
  [leafPath]: md({
    ...frame,
    x: 96,
    y: 144,
    id: 'leaf',
    title: '손자',
    parent_section_id: 'child',
    members: [{ id: 'note', path: notePath }],
  }),
  [notePath]: md({ id: 'note', title: '문서', x: 110, y: 220 }),
});
const environment = { now: () => 10, id: () => 'nested-fixture' };
const run = (files, channel, input) =>
  reduceCollaboration(files, channel, input, environment, true).files;
const data = (files, key) => matter(files[key]).data;
const move = (objectId, relativePath, x, y) => ({
  objectId,
  relativePath,
  ...frame,
  x,
  y,
});

test('a Git clone retains all local nesting without personal state', async (t) => {
  const parent = await fs.mkdtemp(
    path.join(os.tmpdir(), 'nested-sections-git-'),
  );
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const original = path.join(parent, 'original');
  const clone = path.join(parent, 'clone');
  await fs.mkdir(original);
  const files = {
    ...fixture(),
    [PROJECT_LAYOUT_PATH]: JSON.stringify({ version: 2, aliases: {} }),
  };
  await materialize(original, files);
  const git = promisify(execFile);
  await git('git', ['init', '-q', original]);
  await git('git', ['-C', original, 'add', 'docs', '.gamejam/project']);
  await git('git', [
    '-C',
    original,
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'Nested sections',
  ]);
  await git('git', ['clone', '-q', original, clone]);
  const copied = await filesystemProjectRepository(clone).capture();
  assert.deepEqual(
    sectionTree(snapshotSections(copied)).parents,
    sectionTree(snapshotSections(files)).parents,
  );
});

test('empty local child expands every ancestor and preserves sections on disk and undo', async (t) => {
  const before = fixture();
  const after = run(before, 'sections:create', {
    ...frame,
    x: 144,
    y: 216,
    title: '빈 섹션',
    members: [],
    parentSectionId: 'leaf',
  });
  const created = 'sections/section-nested-f.md';
  assert.equal(data(after, created).parent_section_id, 'leaf');
  assert.equal(data(after, parentPath).width, 708);
  assert.equal(data(after, parentPath).custom, '유지');
  assert.equal(data(after, notePath).x, 110);
  assert.deepEqual(invertEdit(after, before, after, 'undo'), before);
  assert.throws(() => checkSnapshot(after), /로컬 프로젝트/);
  checkSnapshot(after, true);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nested-sections-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await materialize(root, after);
  assert.deepEqual(await filesystemProjectRepository(root).capture(), after);
});

test('moving a selected ancestor translates descendants once and stale, cyclic or shared attachment fails', () => {
  const before = fixture();
  const after = run(before, 'layouts:update', {
    updates: [
      { ...move('leaf', leafPath, 196, 194), kind: 'section' },
      { ...move('parent', parentPath, 100, 50), kind: 'section' },
      { ...move('note', notePath, 210, 270), kind: 'document' },
    ],
  });
  assert.equal(data(after, leafPath).x, 196);
  assert.equal(data(after, childPath).y, 122);
  assert.equal(data(after, notePath).x, 210);
  const input = {
    ...move('parent', parentPath, 100, 50),
    membership: { expectedParentId: null, targetParentId: 'leaf' },
  };
  assert.throws(
    () => run(before, 'sections:update-layout', input),
    /자신이나 하위/,
  );
  assert.throws(
    () => reduceCollaboration({}, 'sections:update-layout', input),
    /로컬 프로젝트/,
  );
  assert.throws(
    () =>
      run(before, 'sections:update-layout', {
        ...move('child', childPath, 1, 1),
        membership: { expectedParentId: null, targetParentId: null },
      }),
    /변경/,
  );
  const detached = run(before, 'sections:update-layout', {
    ...move('child', childPath, 500, 500),
    membership: { expectedParentId: 'parent', targetParentId: null },
  });
  assert.equal(data(detached, childPath).parent_section_id, undefined);
  assert.equal(data(detached, leafPath).x, 548);
});

test('dissolve promotes children, recursive deletion checks the confirmed branch, and a failed trash restores it', async (t) => {
  const before = fixture();
  const dissolve = run(before, 'sections:delete', {
    sectionId: 'child',
    relativePath: childPath,
    deleteMembers: false,
  });
  assert.equal(dissolve[childPath], undefined);
  assert.equal(data(dissolve, leafPath).parent_section_id, 'parent');
  assert.equal(dissolve[notePath], before[notePath]);
  const sections = snapshotSections(before);
  const rootSection = sections.find((section) => section.id === 'parent');
  const expectedPaths = sectionDeletionPaths(
    sectionTree(sections),
    rootSection,
    true,
  );
  const input = {
    sectionId: 'parent',
    relativePath: parentPath,
    deleteMembers: true,
    expectedPaths,
  };
  assert.throws(
    () =>
      run(before, 'sections:delete', { ...input, expectedPaths: [parentPath] }),
    /삭제 대상이 변경/,
  );
  const after = run(before, 'sections:delete', input);
  assert.deepEqual(after, {});
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'nested-section-trash-'),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await materialize(root, before);
  const repository = filesystemProjectRepository(root);
  let calls = 0;
  const publisher = filesystemCommandPublisher(root, repository, {
    pauseWatcher: async () => async () => {},
    trashItem: async (file) => {
      if (++calls === 2) throw Error('trash unavailable');
      await fs.unlink(file);
    },
  });
  await assert.rejects(
    publisher.publish('sections:delete', {
      before,
      files: after,
      changes: Object.fromEntries(expectedPaths.map((key) => [key, null])),
    }),
    /trash unavailable/,
  );
  assert.deepEqual(await repository.capture(), before);
});

test('Git-style invalid parent links detach in memory, and canvas transfers and project copies retain valid children', () => {
  const before = fixture();
  const corrupted = {
    ...before,
    [parentPath]: md({
      ...frame,
      id: 'parent',
      parent_section_id: 'leaf',
      members: [],
    }),
  };
  const invalid = sectionTree(snapshotSections(corrupted));
  assert.deepEqual([...invalid.invalid].sort(), ['child', 'leaf', 'parent']);
  const sheets = JSON.stringify({
    version: 1,
    canvases: [
      { id: 'default', name: '기본' },
      { id: 'other', name: '다른 캔버스' },
    ],
  });
  const transferred = run(
    { ...before, ['.canvas/canvases.json']: sheets },
    'canvases:change',
    {
      action: 'move',
      id: 'default',
      targetId: 'other',
      expected: sheets,
      paths: [childPath],
    },
  );
  assert.equal(data(transferred, childPath).parent_section_id, undefined);
  assert.equal(data(transferred, leafPath).parent_section_id, 'child');
  assert.equal(data(transferred, notePath).canvas_id, 'other');
  const bundle = projectCopyBundle(before, {
    canvasId: 'default',
    sections: [{ id: 'child', path: childPath }],
    documents: [],
    drawings: [],
    previews: [],
  });
  assert.deepEqual(bundle.sections, [childPath, leafPath]);
  let id = 0;
  const copied = reduceCollaboration(
    {},
    'projects:import-copy',
    {
      requestId: 'a29ec151-383f-4329-b2f0-acd89f309880',
      canvasId: 'default',
      bundle,
    },
    { ...environment, id: () => String(++id) },
    true,
  ).files;
  const copiedSections = snapshotSections(copied);
  const child = copiedSections.find((section) => section.title === '하위');
  const leaf = copiedSections.find((section) => section.title === '손자');
  assert.equal(child.parentSectionId, undefined);
  assert.equal(leaf.parentSectionId, child.id);
});
