import type { ObjResource } from '../../contracts/documents.ts';
import { IMAGE_MIMES, MAX_IMAGE_BYTES } from './image-assets.ts';

export const MAX_OBJ_RESOURCES = 64;
export const MAX_MTL_BYTES = 2_000_000;
const textureExtensions = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

export function objResourceFormat(name: string) {
  const extension = name.split('.').at(-1)?.toLowerCase();
  if (extension === 'mtl')
    return {
      extension,
      mime: 'text/plain; charset=utf-8',
      maxBytes: MAX_MTL_BYTES,
    };
  if (extension && textureExtensions.includes(extension))
    return {
      extension,
      mime: IMAGE_MIMES[extension],
      maxBytes: MAX_IMAGE_BYTES,
    };
}

export function objResourceLocation(path: unknown) {
  if (typeof path !== 'string') return;
  const match =
    /^assets\/models\/([a-f0-9]{64})\.(mtl|png|jpe?g|webp|gif)$/.exec(path);
  if (match)
    return {
      ...objResourceFormat(path)!,
      digest: match[1],
      kind: 'model' as const,
    };
}

/** Resolve only within the OBJ folder, with Windows and URL path ambiguities rejected. */
export function objResourceName(reference: string, parent = '') {
  const name = reference.trim().replaceAll('\\', '/');
  if (
    !name ||
    name.length > 240 ||
    /^[/"']/.test(name) ||
    /[:?#%<>"|*]/u.test(name) ||
    [...name].some((character) => character.charCodeAt(0) < 32)
  )
    throw Error('OBJ 재질 경로는 모델 폴더 안의 상대 경로여야 합니다.');
  const parts = parent ? parent.split('/').slice(0, -1) : [];
  for (const segment of name.split('/')) {
    if (segment === '.') continue;
    if (segment === '..' && parts.length) parts.pop();
    else if (segment === '..' || !segment || /[. ]$/.test(segment))
      throw Error('OBJ 재질 경로는 모델 폴더 안의 상대 경로여야 합니다.');
    else parts.push(segment);
  }
  if (!parts.length) throw Error('OBJ 재질 파일 이름을 확인해주세요.');
  return parts.join('/');
}

export function objResources(value: unknown): ObjResource[] | undefined {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > MAX_OBJ_RESOURCES
  )
    return;
  const names = new Set<string>();
  const files: ObjResource[] = [];
  for (const item of value) {
    if (!item || typeof item.name !== 'string' || typeof item.path !== 'string')
      return;
    const format = objResourceLocation(item.path);
    if (
      !format ||
      objResourceFormat(item.name)?.extension !== format.extension ||
      !Number.isSafeInteger(item.bytes) ||
      item.bytes < 1 ||
      item.bytes > format.maxBytes ||
      names.has(item.name.toLowerCase())
    )
      return;
    try {
      if (objResourceName(item.name) !== item.name) return;
    } catch {
      return;
    }
    names.add(item.name.toLowerCase());
    files.push({ name: item.name, path: item.path, bytes: item.bytes });
  }
  return files.some((file) => file.name.toLowerCase().endsWith('.mtl'))
    ? files
    : undefined;
}

const sourceText = (text: string) =>
  text
    .replace(/^\uFEFF/, '')
    .replace(/\\\r?\n/g, '')
    .split(/\r?\n/);
export const objMaterialNames = (text: string) =>
  sourceText(text).flatMap((line) => {
    const match = /^\s*mtllib\s+(.+?)\s*$/i.exec(line.replace(/\s+#.*$/, ''));
    if (!match) return [];
    return match[1]
      .split(/(?<=\.mtl)\s+/i)
      .map((name) => objResourceName(name));
  });

const textureDirective =
  /^\s*(?:map_kd|map_ks|map_ke|norm|map_bump|bump|disp|map_d)\s+(.+?)\s*$/i;
export function mtlTextureNames(text: string, material: string) {
  return sourceText(text).flatMap((line) => {
    const match = textureDirective.exec(line);
    if (!match) return [];
    const parts = match[1].trim().split(/\s+/);
    // Same argument counts as the runtime MTL loader.
    for (const [option, count] of [
      ['-bm', 2],
      ['-mm', 3],
      ['-s', 4],
      ['-o', 4],
    ] as const) {
      const index = parts.indexOf(option);
      if (index >= 0) parts.splice(index, count);
    }
    return [objResourceName(parts.join(' '), material)];
  });
}
