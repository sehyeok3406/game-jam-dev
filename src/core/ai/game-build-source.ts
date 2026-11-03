import type { GameBuildSourceV1 } from '../../contracts/game-build-execution.ts';
import type { Snapshot } from '../../contracts/project.ts';
import { GameBuildLimits } from '../../contracts/game-build.ts';
import { isGameBuildSourcePath } from '../projects/game-build.ts';

export function validateGameBuildSource(
  value: unknown,
  sources: Snapshot,
  inputs: Snapshot,
  byteLength: (text: string) => number,
): GameBuildSourceV1 {
  const fail = () => {
    throw Error('게임 소스 명세·파일·에셋 범위를 확인해주세요.');
  };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail();
  const p = value as GameBuildSourceV1;
  if (
    Object.keys(p).some(
      (k) => !['version', 'entry', 'html', 'files', 'assets'].includes(k),
    ) ||
    p.version !== 1 ||
    !isGameBuildSourcePath(p.entry) ||
    !p.entry.endsWith('.js') ||
    !isGameBuildSourcePath(p.html) ||
    !p.html.endsWith('.html') ||
    !Array.isArray(p.files) ||
    p.files.length < 2 ||
    p.files.length > GameBuildLimits.sourceFiles ||
    !p.files.every(isGameBuildSourcePath) ||
    !p.files.includes(p.entry) ||
    !p.files.includes(p.html) ||
    new Set(p.files.map((x) => x.toLowerCase())).size !== p.files.length ||
    Object.keys(sources).length !== p.files.length ||
    p.files.some(
      (x) =>
        typeof sources[x] !== 'string' ||
        byteLength(sources[x]) > GameBuildLimits.sourceBytes,
    ) ||
    Object.values(sources).reduce((n, s) => n + byteLength(s), 0) >
      GameBuildLimits.sourceBundleBytes ||
    !Array.isArray(p.assets) ||
    p.assets.length > 64
  )
    fail();
  const names = new Set<string>();
  for (const asset of p.assets) {
    if (
      !asset ||
      Object.keys(asset).some((k) => !['key', 'path'].includes(k)) ||
      typeof asset.key !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(asset.key) ||
      names.has(asset.key) ||
      typeof asset.path !== 'string' ||
      !asset.path.startsWith('assets/images/') ||
      inputs[asset.path] === undefined
    )
      fail();
    names.add(asset.key);
  }
  // Include ancestors: a file cannot also be another file's directory, even on Windows.
  const spellings = new Map<string, string>(),
    paths = new Set(p.files.map((x) => x.toLowerCase()));
  for (const file of p.files) {
    const parts = file.split('/');
    for (let n = 1; n <= parts.length; n++) {
      const s = parts.slice(0, n).join('/'),
        k = s.toLowerCase();
      if (
        (spellings.has(k) && spellings.get(k) !== s) ||
        (n < parts.length && paths.has(k))
      )
        fail();
      spellings.set(k, s);
    }
  }
  return { ...p, files: [...p.files], assets: p.assets.map((a) => ({ ...a })) };
}
