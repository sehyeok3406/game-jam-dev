import fs from 'node:fs/promises';
import path from 'node:path';
import type { ModelAsset, ObjResource } from '../../contracts/documents.ts';
import {
  MAX_OBJ_RESOURCES,
  mtlTextureNames,
  objMaterialNames,
  objResourceFormat,
} from '../../core/projects/obj-resources.ts';
import {
  MAX_LOCAL_MEDIA_BATCH_BYTES,
  MAX_MODEL_BYTES,
} from '../../core/projects/model-assets.ts';
import { stageLocalMedia } from './local-media.ts';

/** Read only the relative dependencies listed inside the selected OBJ and its MTL files. */
export async function stageObjModel(
  root: string,
  source: string | Uint8Array,
  originalName: string,
  expectedBytes: number,
  check: () => void,
): Promise<ModelAsset> {
  const disk = typeof source === 'string';
  const bytes = disk ? await readBounded(source, MAX_MODEL_BYTES) : source;
  if (bytes.byteLength !== expectedBytes || bytes.byteLength > MAX_MODEL_BYTES)
    throw Error(`${originalName}: OBJ 원본 파일을 다시 선택해주세요.`);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const libraries = new Set(objMaterialNames(decoder.decode(bytes)));
  const stage = () =>
    stageLocalMedia(root, bytes, originalName, expectedBytes, check);
  if (!libraries.size) return stage();
  if (!disk)
    throw Error(
      '재질이 연결된 OBJ는 디스크에서 원본 OBJ를 선택하거나 드롭해주세요.',
    );
  const folder = path.dirname(await fs.realpath(source));
  const resources = new Map<string, ObjResource>();
  let total = bytes.byteLength;
  const add = async (name: string, material: boolean) => {
    const key = name.toLowerCase();
    if (resources.has(key)) return;
    const format = objResourceFormat(name);
    if (!format || (format.extension === 'mtl') !== material)
      throw Error(
        `${name}: MTL 또는 PNG, JPG, WebP, GIF 형식인지 확인해주세요.`,
      );
    if (resources.size >= MAX_OBJ_RESOURCES)
      throw Error('OBJ 한 개에 연결된 재질 및 텍스처가 너무 많습니다.');
    check();
    const filename = await fs
      .realpath(path.resolve(folder, name))
      .catch((error) => {
        if (error.code === 'ENOENT')
          throw Error(`OBJ에 연결된 파일을 찾을 수 없습니다: ${name}`);
        throw error;
      });
    const location = path.relative(folder, filename);
    if (
      !location ||
      location === '..' ||
      location.startsWith('..' + path.sep) ||
      path.isAbsolute(location)
    )
      throw Error(`OBJ 폴더 밖에 있는 재질은 가져올 수 없습니다: ${name}`);
    const data = await readBounded(filename, format.maxBytes);
    total += data.length;
    if (total > MAX_LOCAL_MEDIA_BATCH_BYTES)
      throw Error(
        'OBJ와 연결된 재질 파일의 합계는 256MiB까지 가져올 수 있습니다.',
      );
    const staged = await stageLocalMedia(
      root,
      data,
      name,
      data.length,
      check,
      undefined,
      true,
    );
    resources.set(key, { name, path: staged.path, bytes: staged.bytes });
    if (material)
      for (const texture of mtlTextureNames(decoder.decode(data), name))
        await add(texture, false);
  };
  for (const material of libraries) await add(material, true);
  return { ...(await stage()), resources: [...resources.values()] };
}

async function readBounded(file: string, max: number) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > max)
      throw Error(`${path.basename(file)}: 파일 형식이나 크기를 확인해주세요.`);
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (!bytesRead) throw Error('OBJ 또는 연결 파일이 변경되었습니다.');
      offset += bytesRead;
    }
    return buffer;
  } finally {
    await handle.close();
  }
}
