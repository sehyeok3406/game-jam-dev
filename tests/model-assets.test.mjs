import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  planLocalMediaChanges,
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
import { stageObjModel } from '../src/adapters/filesystem/obj-import.ts';
import { localMediaPaths } from '../src/core/projects/local-media.ts';
import { openObjResource } from '../src/adapters/filesystem/local-media.ts';
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

test('an OBJ imports only its relative libraries and textures and restores them with the card', async (t) => {
  const root = await workspace(t);
  const origin = path.join(root, 'source');
  await fs.mkdir(path.join(origin, 'materials'), { recursive: true });
  const objSource = Buffer.from(
    'mtllib materials/hero body.mtl other.mtl\n' + obj.toString(),
  );
  const filename = path.join(origin, 'model.obj');
  await fs.writeFile(filename, objSource);
  const mtl = path.join(origin, 'materials', 'hero body.mtl');
  await fs.writeFile(mtl, 'newmtl Hero\nmap_Kd -s 1 1 1 ../hero.gif');
  await fs.writeFile(path.join(origin, 'other.mtl'), 'newmtl Other\nKd 0 1 0');
  await assert.rejects(
    stageObjModel(root, filename, 'model.obj', objSource.length, check),
    /hero.gif/,
  );
  const gif = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64',
  );
  await fs.writeFile(path.join(origin, 'hero.gif'), gif);
  const model = await stageObjModel(
    root,
    filename,
    'model.obj',
    objSource.length,
    check,
  );
  assert.deepEqual(
    model.resources.map((file) => file.name),
    ['materials/hero body.mtl', 'hero.gif', 'other.mtl'],
  );
  const card = importModel(model);
  await applyChanges(root, {}, card);
  const opened = await openObjResource(root, model.resources[1]);
  assert.deepEqual(await opened.readFile(), gif);
  await opened.close();
  const paths = localMediaPaths(model).map((relative) =>
    path.join(root, relative),
  );
  await applyChanges(root, card, { [Object.keys(card)[0]]: null });
  for (const file of paths)
    await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  await applyChanges(root, {}, card);
  for (const file of paths) assert.ok((await fs.stat(file)).isFile());
  await fs.writeFile(mtl, 'newmtl Hero\nmap_Kd ../../outside.gif');
  await assert.rejects(
    stageObjModel(root, filename, 'model.obj', objSource.length, check),
    /상대 경로/,
  );
});

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

test('a removed game revision keeps one recoverable image by content hash', async (t) => {
  const root = await workspace(t);
  const bytes = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64',
  );
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const imagePath = 'assets/images/art.gif';
  const manifestPath =
    '.game-builds/12345678-1234-1234-1234-123456789abc/manifest.json';
  const manifest = JSON.stringify({
    assets: [
      {
        key: 'art',
        kind: 'image',
        path: imagePath,
        sha256,
        bytes: bytes.length,
      },
    ],
  });
  const original = path.join(root, imagePath);
  await fs.mkdir(path.dirname(original), { recursive: true });
  await fs.writeFile(original, bytes);
  const baseline = { [manifestPath]: manifest, [imagePath]: 'tracked' };
  await planLocalMediaChanges(root, baseline, { [manifestPath]: null }, check);
  await fs.rm(original);
  const { create } = await planLocalMediaChanges(
    root,
    {},
    { [manifestPath]: manifest },
    check,
  );
  assert.equal(create.length, 1);
  assert.equal(create[0].file, path.join(await fs.realpath(root), imagePath));
  assert.deepEqual(await fs.readFile(create[0].object), bytes);
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
