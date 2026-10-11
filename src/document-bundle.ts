import matter from './markdown.ts';
import { CanvasError } from './app-errors.ts';
import { documentVersion } from './document-output.ts';
import { expectedArtifacts } from './ai-artifacts.ts';
import type { Snapshot } from './project-store.ts';
import { validateDocumentFormat } from './document-format.ts';

export const MAX_SYSTEM_DOCUMENTS = 20;
export type DocumentBundleContract = {
  version: 1;
  id: string;
  overview: string;
  systemPrefix: string;
  maxSystems: number;
};
const fail = (message: string): never => {
  throw new CanvasError('GC-AI-004', `시스템 문서 묶음: ${message}`);
};

/** Only the frozen app-authored namespace may contain variable AI outputs. */
export function documentBundleContract(
  raw: string,
): DocumentBundleContract | null {
  const data = matter(raw).data;
  const bundle = data.document_bundle as DocumentBundleContract | undefined;
  if (bundle === undefined) return null;
  if (
    !bundle ||
    bundle.version !== 1 ||
    typeof bundle.id !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(bundle.id) ||
    typeof bundle.overview !== 'string' ||
    !bundle.overview.endsWith('game-overview.md') ||
    bundle.systemPrefix !==
      bundle.overview.slice(0, -'game-overview.md'.length) + 'system-' ||
    bundle.maxSystems !== MAX_SYSTEM_DOCUMENTS
  )
    fail('출력 명세가 올바르지 않습니다. 새 작업을 만들어주세요.');
  documentVersion(bundle.overview.slice(0, bundle.overview.lastIndexOf('/')));
  if (!expectedArtifacts(raw).includes(bundle.overview))
    fail('개요 문서가 지정 출력에 없습니다.');
  return bundle;
}

export function bundleOutputAllowed(
  bundle: DocumentBundleContract,
  path: string,
) {
  if (path === bundle.overview) return true;
  return (
    path.startsWith(bundle.systemPrefix) &&
    /^[a-z0-9][a-z0-9-]{0,63}\.md$/.test(path.slice(bundle.systemPrefix.length))
  );
}

/** Resolve a complete index, not arbitrary files found in the staging folder. */
export function resolveTaskArtifacts(
  raw: string,
  files: Snapshot,
  before?: Snapshot,
): string[] {
  const expected = expectedArtifacts(raw);
  validateDocumentFormat(raw, files, before);
  const bundle = documentBundleContract(raw);
  if (!bundle) return expected;
  if (!files[bundle.overview]) fail('게임 개요 문서가 없습니다.');
  const overview = matter(files[bundle.overview]).data;
  const index = overview.document_bundle;
  if (
    overview.type !== 'overview' ||
    !index ||
    index.version !== 1 ||
    index.id !== bundle.id ||
    !Array.isArray(index.systems) ||
    !index.systems.length ||
    index.systems.length > bundle.maxSystems
  )
    fail(
      `개요의 document_bundle에 시스템 목록을 1~${bundle.maxSystems}개 기록해주세요.`,
    );
  const paths = new Set<string>();
  const ids = new Set<string>();
  const keys = new Set<string>();
  const previousIndex = before?.[bundle.overview]
    ? matter(before[bundle.overview]).data.document_bundle
    : undefined;
  if (previousIndex && !Array.isArray(previousIndex.systems))
    fail('기존 개요의 시스템 목록을 확인해주세요.');
  for (const system of index.systems) {
    if (
      !system ||
      typeof system.key !== 'string' ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(system.key) ||
      typeof system.id !== 'string' ||
      !system.id.trim() ||
      typeof system.title !== 'string' ||
      !system.title.trim() ||
      system.path !== `${bundle.systemPrefix}${system.key}.md` ||
      !bundleOutputAllowed(bundle, system.path)
    )
      fail('시스템 key/id/title/path 또는 출력 경로가 올바르지 않습니다.');
    if (keys.has(system.key) || paths.has(system.path) || ids.has(system.id))
      fail('시스템 목록에 중복된 경로·ID·key가 있습니다.');
    keys.add(system.key);
    paths.add(system.path);
    ids.add(system.id);
    const previousSystem = previousIndex?.systems?.find(
      (item: { path?: string }) => item.path === system.path,
    );
    if (
      previousSystem &&
      (previousSystem.id !== system.id || previousSystem.key !== system.key)
    )
      fail(`기존 목록의 문서 ID와 key를 유지해주세요: ${system.path}`);
    if (!files[system.path]) fail(`시스템 문서가 없습니다: ${system.path}`);
    const doc = matter(files[system.path]).data;
    if (
      doc.type !== 'system' ||
      doc.id !== system.id ||
      doc.title !== system.title ||
      doc.document_bundle_id !== bundle.id ||
      doc.system_id !== `${bundle.id}:${system.key}`
    )
      fail(
        `개요 목록과 시스템 문서의 정보가 일치하지 않습니다: ${system.path}`,
      );
    if (before?.[system.path] && !expected.includes(system.path))
      fail(`기존의 다른 문서를 덮어쓸 수 없습니다: ${system.path}`);
    if (before?.[system.path]) {
      const old = matter(before[system.path]).data;
      if (old.system_id && old.system_id !== doc.system_id)
        fail(`기존 시스템 ID를 유지해주세요: ${system.path}`);
    }
  }
  const resolved = [bundle.overview, ...paths];
  for (const path of expected.filter((path) => path.endsWith('.md')))
    if (!resolved.includes(path))
      fail(`기존 문서를 목록에서 누락할 수 없습니다: ${path}`);
  return [...resolved, ...expected.filter((path) => !path.endsWith('.md'))];
}

export function documentBundleRules(bundle: DocumentBundleContract) {
  return [
    `- 게임 개요 1개와 기능 단위의 시스템 문서 1~${bundle.maxSystems}개를 만든다. 함수별로 잘게 나누지 않고 같은 책임의 하위 기능을 묶는다.`,
    `- 개요 경로는 ${JSON.stringify(bundle.overview)}이다. 개요의 type은 overview이며 전체 플레이 흐름, 시스템 목록과 연결 관계, 확인 필요 사항을 정리한다.`,
    `- 먼저 시스템 목록을 정하고 개요의 frontmatter에 document_bundle: {version: 1, id: ${JSON.stringify(bundle.id)}, systems: [{key, id, title, path}, ...]}를 기록한 다음 목록에 대응하는 시스템 문서를 모두 작성한다.`,
    `- 시스템 key는 영문 소문자·숫자·하이픈으로 1~64자, path는 ${JSON.stringify(bundle.systemPrefix)} + key + '.md'이다. key/id/path는 중복되지 않아야 한다.`,
    `- 각 시스템 문서의 frontmatter에는 type: system, 목록과 동일한 id/title, document_bundle_id: ${JSON.stringify(bundle.id)}, system_id: ${JSON.stringify(bundle.id + ':')} + key와 필수 status/sources를 기록한다.`,
    '- 각 시스템 문서에는 역할, 조작·작동 조건, 처리 순서, 상태 변화, 수치·계산식, 다른 시스템과의 연결, 근거와 확인 필요 사항을 정리한다. 입력에 없는 시스템이나 기획 의도는 사실로 만들지 않는다.',
    '- 기존 묶음 업데이트는 기존 문서 ID·system_id·key/path를 유지하고 기존 문서를 목록에서 누락하거나 삭제하지 않는다. 새로운 시스템 문서는 위 경로 규칙 안에서 추가할 수 있다.',
    '- expected_outputs의 필수 파일과 이 명세에 따라 개요 목록에 기록한 시스템 문서만 작성한다. 목록에 없는 파일·다른 경로의 결과는 반영하지 않는다.',
  ].join('\n');
}
