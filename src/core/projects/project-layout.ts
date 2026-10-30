import {
  PROJECT_LAYOUT_PATH,
  type ProjectLayout,
} from '../../contracts/project-layout.ts';
import type { Snapshot } from '../../contracts/project.ts';

export function readProjectLayout(files: Snapshot): ProjectLayout | null {
  const raw = files[PROJECT_LAYOUT_PATH];
  if (raw === undefined) return null;
  const data = JSON.parse(raw) as ProjectLayout;
  if (
    data.version !== 2 ||
    !data.aliases ||
    typeof data.aliases !== 'object' ||
    Array.isArray(data.aliases)
  )
    throw Error(
      '프로젝트 파일 구조 버전을 지원하지 않습니다. 앱을 업데이트해주세요.',
    );
  const destinations = new Set<string>();
  for (const [from, to] of Object.entries(data.aliases)) {
    if (
      !/^(?:project\.md|(?:ideas|docs)\/.+\.md)$/.test(from) ||
      typeof to !== 'string' ||
      !/^docs\/[^/\\<>:"|?*]+\.md$/.test(to) ||
      [...to].some((character) => character.charCodeAt(0) < 32) ||
      from.includes('..') ||
      to.includes('..') ||
      destinations.has(to.toLowerCase())
    )
      throw Error('프로젝트 파일 이전 정보가 올바르지 않습니다.');
    destinations.add(to.toLowerCase());
  }
  return data;
}

const physicalPrefixes = [
  ['.canvas/layout.json', '.gamejam/project/layout.json'],
  ['.canvas/project.json', '.gamejam/project/metadata.json'],
  ['.canvas/authorship.json', '.gamejam/local/authorship.json'],
  ['.canvas/preview.json', '.gamejam/local/previews/default.json'],
  ['.canvas/previews', '.gamejam/local/previews'],
  ['.canvas', '.gamejam/project/canvas'],
  ['docs/html-sources', '.gamejam/project/html'],
  ['docs/text-sources', '.gamejam/project/text'],
  ['sections', '.gamejam/project/sections'],
  ['.ai/tasks', '.gamejam/project/ai/tasks'],
  ['.history', '.gamejam/local/history'],
  ['server-cache.json', '.gamejam/local/sync/server-cache.json'],
  ['.sync-blobs', '.gamejam/local/sync/blobs'],
] as const;

export function physicalProjectPath(relative: string, modern: boolean) {
  if (!modern && relative !== PROJECT_LAYOUT_PATH) return relative;
  for (const [logical, physical] of physicalPrefixes)
    if (relative === logical || relative.startsWith(`${logical}/`))
      return physical + relative.slice(logical.length);
  return relative;
}
export function logicalProjectPath(relative: string) {
  for (const [logical, physical] of physicalPrefixes)
    if (relative === physical || relative.startsWith(`${physical}/`))
      return logical + relative.slice(physical.length);
  return relative;
}
