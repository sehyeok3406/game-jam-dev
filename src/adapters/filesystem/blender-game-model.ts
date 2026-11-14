import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { GameBuildAssetFile } from '../../contracts/game-build.ts';
import { GAME_MODEL_DIRECTORY } from '../../core/projects/game-build-assets.ts';
import { MAX_LOCAL_MEDIA_BATCH_BYTES } from '../../core/projects/model-assets.ts';
import { projectPath } from '../../project-store.ts';
import { openVerifiedAssetFile } from './local-media.ts';

const run = promisify(execFile);
const script = `
import bpy
import sys

unpacked_images = [
    image for image in bpy.data.images
    if image.source not in {"GENERATED", "VIEWER"} and not image.packed_files
]
if bpy.data.libraries or unpacked_images:
    raise RuntimeError("Pack external resources into the Blender file first")
if not any(obj.type == "MESH" for obj in bpy.context.scene.objects):
    raise RuntimeError("The Blender scene has no mesh to export")
result = bpy.ops.export_scene.gltf(filepath=sys.argv[-1], export_format="GLB")
if "FINISHED" not in result:
    raise RuntimeError("GLB export did not complete")
`;

async function installedBlender(signal: AbortSignal) {
  const base = process.env.ProgramFiles;
  if (base) {
    const directory = path.join(base, 'Blender Foundation');
    const versions = await fs.readdir(directory).catch(() => []);
    for (const name of versions.sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true }),
    )) {
      if (!/^Blender (?:[4-9]|[1-9]\d+)\.\d+$/.test(name)) continue;
      const executable = path.join(directory, name, 'blender.exe');
      if (
        await fs.stat(executable).then(
          (stat) => stat.isFile(),
          () => false,
        )
      )
        return executable;
    }
  }
  signal.throwIfAborted();
  throw Error(
    'Blender 4.x 이상을 설치하거나 이 모델을 단일 GLB로 내보내 캔버스에 추가해주세요.',
  );
}

/** Keep one derived GLB for every distinct output, shared by all game revisions. */
export async function prepareBlenderGameModel(
  root: string,
  source: GameBuildAssetFile,
  signal: AbortSignal,
): Promise<GameBuildAssetFile> {
  await (await openVerifiedAssetFile(root, source, 'blend', signal)).close();
  const index = await projectPath(
    root,
    `${GAME_MODEL_DIRECTORY}/${source.sha256}.json`,
    true,
  );
  const cached = await fs.readFile(index, 'utf8').catch(() => '');
  if (cached.length < 512) {
    try {
      const { sha256, bytes } = JSON.parse(cached) as GameBuildAssetFile;
      if (
        /^[a-f0-9]{64}$/.test(sha256) &&
        Number.isSafeInteger(bytes) &&
        bytes > 0 &&
        bytes <= MAX_LOCAL_MEDIA_BATCH_BYTES
      ) {
        const file = {
          path: `${GAME_MODEL_DIRECTORY}/${sha256}.glb`,
          sha256,
          bytes,
        };
        await (await openVerifiedAssetFile(root, file, 'glb', signal)).close();
        return file;
      }
    } catch {
      signal.throwIfAborted();
    }
  }
  const executable = await installedBlender(signal);
  const original = await projectPath(root, source.path);
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-blender-'));
  try {
    const output = path.join(work, 'model.glb');
    try {
      await run(
        executable,
        [
          '--background',
          '--factory-startup',
          '--disable-autoexec',
          '--offline-mode',
          original,
          '--python-exit-code',
          '1',
          '--python-expr',
          script,
          '--',
          output,
        ],
        {
          cwd: work,
          timeout: 120_000,
          signal,
          windowsHide: true,
          maxBuffer: 512_000,
        },
      );
    } catch (error) {
      signal.throwIfAborted();
      throw Error(
        'Blender 모델을 변환할 수 없습니다. 외부 리소스를 포함하고 메시가 있는 파일로 저장해주세요.',
        { cause: error },
      );
    }
    await (await openVerifiedAssetFile(root, source, 'blend', signal)).close();
    const { size: bytes } = await fs.stat(output);
    if (bytes < 1 || bytes > MAX_LOCAL_MEDIA_BATCH_BYTES)
      throw Error('변환한 GLB는 256MiB까지 사용할 수 있습니다.');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(output, { signal }))
      hash.update(chunk);
    const sha256 = hash.digest('hex');
    const file = {
      path: `${GAME_MODEL_DIRECTORY}/${sha256}.glb`,
      sha256,
      bytes,
    };
    const target = await projectPath(root, file.path, true);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const staged = `${target}.${path.basename(work)}.tmp`;
    const stagedIndex = `${index}.${path.basename(work)}.tmp`;
    try {
      await fs.copyFile(output, staged);
      signal.throwIfAborted();
      await fs.link(staged, target).catch((error) => {
        if (error.code !== 'EEXIST') throw error;
      });
      await (await openVerifiedAssetFile(root, file, 'glb', signal)).close();
      await fs.writeFile(stagedIndex, JSON.stringify(file));
      signal.throwIfAborted();
      await fs.rename(stagedIndex, index);
      return file;
    } finally {
      await Promise.all(
        [staged, stagedIndex].map((file) => fs.rm(file, { force: true })),
      );
    }
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
