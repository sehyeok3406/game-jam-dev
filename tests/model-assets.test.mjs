import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
import {
  MAX_MODEL_BYTES,
  modelAsset,
  modelSizeLimit,
} from '../src/core/projects/model-assets.ts';
import { buildFileImports } from '../src/file-assets.ts';
import { applyChanges, captureProject } from '../src/project-store.ts';

async function workspace(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-model-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

const check = () => {};
const obj = Buffer.from('o triangle\nv 0 0 0\nv 0 1 0\nv 1 0 0\nf 1 2 3\n');
const importModel = (asset, previous = {}) =>
  buildFileImports(
    {
      x: 0,
      y: 0,
      imagePurpose: 'asset',
      files: [{ name: asset.originalName, content: JSON.stringify(asset) }],
    },
    undefined,
    previous,
    true,
  );

test('local model import and copy preserve bytes, duplicate references, and last-card restore', async (t) => {
  const root = await workspace(t);
  const target = await workspace(t);
  const model = await stageLocalMedia(
    root,
    obj,
    '삼각형.obj',
    obj.length,
    check,
  );
  assert.equal(
    model.path,
    `assets/models/${createHash('sha256').update(obj).digest('hex')}.obj`,
  );
  const first = importModel(model);
  const second = importModel(model, first);
  const [a] = Object.keys(first);
  const [b] = Object.keys(second);
  assert.deepEqual(snapshotDocuments(first)[0].model, model);
  assert.throws(() => checkSnapshot(first), /3D 모델 노드는 로컬/);
  await applyChanges(root, {}, first);
  await applyChanges(root, first, second);
  await stageProjectMedia(target, root, model.path, check);
  await applyChanges(target, {}, first);
  assert.deepEqual(await fs.readFile(path.join(target, model.path)), obj);
  const before = await captureProject(root);
  assert.equal(before[model.path], undefined);
  const binary = path.join(root, model.path);
  await applyChanges(root, before, { [a]: null });
  assert.deepEqual(await fs.readFile(binary), obj);
  await applyChanges(root, second, { [b]: null });
  await assert.rejects(fs.stat(binary), { code: 'ENOENT' });
  await applyChanges(root, {}, second);
  assert.deepEqual(await fs.readFile(binary), obj);
});

test('model staging rejects corrupt GLB headers, respects per-format limits and keeps Git LFS pointers', async (t) => {
  const root = await workspace(t);
  const bogus = Buffer.from('glTF invalid data');
  await assert.rejects(
    stageLocalMedia(root, bogus, 'broken.glb', bogus.length, check),
    /3D 모델 형식/,
  );
  assert.deepEqual(
    await fs.readdir(path.join(root, '.gamejam/local/model-objects')),
    [],
  );
  await assert.rejects(
    stageLocalMedia(root, obj, 'big.obj', MAX_MODEL_BYTES + 1, check),
    /50MiB/,
  );
  const blend = 'assets/models/' + 'a'.repeat(64) + '.blend';
  const source = {
    path: blend,
    originalName: 'large.blend',
    bytes: 256 * 1024 * 1024,
  };
  assert.equal(source.bytes, modelSizeLimit('blend'));
  assert.deepEqual(modelAsset(source), source);
  assert.equal(modelAsset({ ...source, bytes: source.bytes + 1 }), undefined);
  const asset = await stageLocalMedia(
    root,
    obj,
    'model.obj',
    obj.length,
    check,
  );
  const card = importModel(asset);
  await applyChanges(root, {}, card);
  const binary = path.join(root, asset.path);
  const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${'1'.repeat(64)}\nsize ${obj.length}\n`;
  await fs.writeFile(binary, pointer);
  await assert.rejects(
    stageProjectMedia(root, root, asset.path, check),
    /git lfs pull/,
  );
  await applyChanges(root, card, { [Object.keys(card)[0]]: null });
  assert.equal(await fs.readFile(binary, 'utf8'), pointer);
});
