import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  stageLocalMedia,
  stageProjectMedia,
} from '../src/adapters/filesystem/local-media.ts';
import {
  checkSnapshot,
  snapshotDocuments,
} from '../src/collaboration-model.ts';
import { buildFileImports } from '../src/file-assets.ts';
import { applyChanges, captureProject } from '../src/project-store.ts';

function pcmWave() {
  const bytes = Buffer.alloc(60);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(16, 40);
  return bytes;
}

async function workspace(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-audio-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function imports(asset, existing = {}) {
  return buildFileImports(
    {
      x: 0,
      y: 0,
      imagePurpose: 'asset',
      files: [{ name: asset.originalName, content: JSON.stringify(asset) }],
    },
    { id: randomUUID, now: Date.now },
    existing,
    true,
  );
}

test('local audio bytes survive copy, duplicate references and last-card restore', async (t) => {
  const root = await workspace(t);
  const destination = await workspace(t);
  const bytes = pcmWave();
  const asset = await stageLocalMedia(
    root,
    bytes,
    '테스트.wav',
    bytes.length,
    () => {},
  );
  assert.equal(
    asset.path,
    `assets/audio/${createHash('sha256').update(bytes).digest('hex')}.wav`,
  );
  const first = imports(asset);
  const second = imports(asset, first);
  const [a] = Object.keys(first);
  const [b] = Object.keys(second);
  const binary = path.join(root, asset.path);
  assert.deepEqual(snapshotDocuments(first)[0].audio, asset);
  assert.throws(() => checkSnapshot(first), /로컬 프로젝트/);
  await applyChanges(root, {}, first);
  await applyChanges(root, first, second);
  await stageProjectMedia(destination, root, asset.path, () => {});
  await applyChanges(destination, {}, first);
  assert.deepEqual(
    await fs.readFile(path.join(destination, asset.path)),
    bytes,
  );
  const both = await captureProject(root);
  assert.equal(both[asset.path], undefined);
  await applyChanges(root, both, { [a]: null });
  assert.deepEqual(await fs.readFile(binary), bytes);
  await applyChanges(root, second, { [b]: null });
  await assert.rejects(fs.stat(binary), { code: 'ENOENT' });
  await applyChanges(root, {}, second);
  assert.deepEqual(await fs.readFile(binary), bytes);
});

test('invalid audio never publishes and Git LFS pointers survive card removal', async (t) => {
  const root = await workspace(t);
  const bytes = pcmWave();
  const check = () => {};
  await assert.rejects(
    stageLocalMedia(root, Buffer.alloc(60), 'fake.wav', 60, check),
    /지원하는 오디오 형식/,
  );
  assert.deepEqual(
    await fs.readdir(path.join(root, '.gamejam/local/audio-objects')),
    [],
  );
  const asset = await stageLocalMedia(
    root,
    bytes,
    'original.wav',
    bytes.length,
    check,
  );
  const first = imports(asset);
  const [relative] = Object.keys(first);
  const binary = path.join(root, asset.path);
  await applyChanges(root, {}, first);
  const pointer =
    'version https://git-lfs.github.com/spec/v1\noid sha256:' +
    '1'.repeat(64) +
    '\nsize 60\n';
  await fs.writeFile(binary, pointer);
  await assert.rejects(
    stageProjectMedia(root, root, asset.path, check),
    /git lfs pull/,
  );
  await applyChanges(root, first, { [relative]: null });
  assert.equal(await fs.readFile(binary, 'utf8'), pointer);
});
