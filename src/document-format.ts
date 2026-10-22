import type { DocumentOutputTemplate } from './contracts/document-output.ts';
export type { DocumentOutputTemplate } from './contracts/document-output.ts';
import matter from './markdown.ts';
import { CanvasError } from './app-errors.ts';
import { expectedArtifacts } from './ai-artifacts.ts';
import type { Snapshot } from './project-store.ts';
export const MAX_FORMAT_DOCUMENTS = 21;
export type DocumentOutputFormat = {
  version: 1;
  id: string;
  documents: (DocumentOutputTemplate & {
    path: string;
  })[];
};
export function defaultDocumentTemplates(): DocumentOutputTemplate[] {
  return [
    {
      key: 'd1',
      title: '게임 개요',
      type: 'overview',
      instructions: '게임의 목적, 장르, 주요 특징과 전체 구조를 정리한다.',
    },
    {
      key: 'd2',
      title: '핵심 플레이',
      type: 'system',
      instructions:
        '조작, 목표, 시작·플레이·종료 흐름, 점수·승패 조건과 핵심 게임 루프를 정리한다.',
    },
    {
      key: 'd3',
      title: '모호한 점',
      type: 'question',
      instructions:
        '모순, 미결정 사항, 분석 불가능한 부분과 추가 확인이 필요한 사항을 목록으로 정리한다.',
    },
  ];
}
const fail = (message: string): never => {
  throw new CanvasError('GC-AI-004', `문서 출력 구성: ${message}`);
};
export function documentTemplates(value: unknown): DocumentOutputTemplate[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > MAX_FORMAT_DOCUMENTS
  )
    return fail(`문서를 1~${MAX_FORMAT_DOCUMENTS}개 지정해주세요.`);
  const keys = new Set<string>();
  let length = 0;
  return value.map((item) => {
    if (
      !item ||
      typeof item.key !== 'string' ||
      !/^d[1-9]\d{0,5}$/.test(item.key) ||
      keys.has(item.key)
    )
      fail('문서 식별자가 올바르지 않거나 중복되었습니다.');
    keys.add(item.key);
    if (
      typeof item.title !== 'string' ||
      !item.title.trim() ||
      item.title.length > 120
    )
      fail('각 문서 제목은 1~120자로 입력해주세요.');
    if (!['overview', 'system', 'question'].includes(item.type))
      fail('문서 종류를 확인해주세요.');
    if (
      typeof item.instructions !== 'string' ||
      item.instructions.length > 4000
    )
      fail('문서별 포함할 내용은 4,000자 이하로 입력해주세요.');
    if (
      [...(item.title + item.instructions)].some((character) => {
        const code = character.charCodeAt(0);
        return (
          (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
          code === 127
        );
      })
    )
      fail('사용할 수 없는 제어 문자가 있습니다.');
    length += item.title.length + item.instructions.length;
    if (length > 20000) fail('전체 출력 구성은 20,000자 이하로 입력해주세요.');
    return {
      key: item.key,
      title: item.title.trim(),
      type: item.type,
      instructions: item.instructions.replace(/\r\n?/g, '\n').trim(),
    };
  });
}
export function taskDocumentFormat(raw: string): DocumentOutputFormat | null {
  const format = matter(raw).data.document_output_format as
    | DocumentOutputFormat
    | undefined;
  if (format === undefined) return null;
  if (
    !format ||
    format.version !== 1 ||
    typeof format.id !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(format.id)
  )
    fail('저장된 출력 구성 명세를 확인해주세요.');
  const templates = documentTemplates(format.documents);
  const outputs = expectedArtifacts(raw).filter((path) => path.endsWith('.md'));
  if (
    outputs.length !== templates.length ||
    new Set(format.documents.map((doc) => doc.path)).size !==
      templates.length ||
    format.documents.some((doc) => !outputs.includes(doc.path))
  )
    fail('출력 파일과 문서 구성 명세가 일치하지 않습니다.');
  return {
    ...format,
    documents: templates.map((doc, index) => ({
      ...doc,
      path: format.documents[index].path,
    })),
  };
}
export function validateDocumentFormat(
  raw: string,
  files: Snapshot,
  before?: Snapshot,
) {
  const format = taskDocumentFormat(raw);
  if (!format) return;
  for (const template of format.documents) {
    if (!files[template.path]) fail(`문서가 없습니다: ${template.title}`);
    const data = matter(files[template.path]).data;
    if (
      data.title !== template.title ||
      data.type !== template.type ||
      data.document_bundle_id !== format.id ||
      data.document_output?.key !== template.key ||
      data.document_output?.instructions !== template.instructions
    )
      fail(`설정과 문서 정보가 일치하지 않습니다: ${template.title}`);
    if (
      template.type === 'system' &&
      data.system_id !== `${format.id}:${template.key}`
    )
      fail(`시스템 ID를 확인해주세요: ${template.title}`);
    if (before?.[template.path]) {
      const old = matter(before[template.path]).data;
      if (
        (old.document_output?.key &&
          old.document_output.key !== template.key) ||
        (old.system_id && old.system_id !== data.system_id)
      )
        fail(`기존 식별자를 유지해주세요: ${template.title}`);
    }
  }
}
export function documentFormatRules(format: DocumentOutputFormat) {
  return [
    '- 이 작업의 문서 개수·역할·본문 구성은 아래 사용자가 편집한 출력 구성에 따른다. 게임 개요·핵심 플레이·모호한 점 또는 시스템별 양식을 별도로 강제하지 않는다.',
    `- 지정한 ${format.documents.length}개 Markdown만 작성한다. 각 문서는 다음 path/title/type 및 포함할 내용을 따른다: ${JSON.stringify(format.documents)}`,
    `- 각 문서 frontmatter에는 document_bundle_id: ${JSON.stringify(format.id)}, document_output: {key, instructions}를 위 명세와 정확히 동일하게 기록한다. type이 system인 문서는 system_id: ${JSON.stringify(format.id + ':')} + key도 기록한다.`,
    '- 필수 id/status/sources와 출처·원본 보호 규칙은 유지한다. 기존 문서 갱신 시 문서 ID와 식별자를 유지한다. 기존 system_id는 문서 종류를 바꾸어도 유지한다.',
  ].join('\n');
}
