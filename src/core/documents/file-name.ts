export const MAX_DOCUMENT_NAME = 100;
export const fileNameKey = (value: string) =>
  value.normalize('NFC').toLowerCase();

/** This is the actual saved filename stem; never silently replace forbidden characters. */
export function documentName(value: unknown): string {
  if (typeof value !== 'string')
    throw Error('문서 이름을 텍스트로 입력해주세요.');
  if (
    [...value].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    throw Error('문서 이름에는 줄바꿈·탭 등 제어 문자를 사용할 수 없습니다.');
  const name = value.trim().normalize('NFC');
  if (
    [...name].some((char) => char.length === 1 && /[\ud800-\udfff]/.test(char))
  )
    throw Error('문서 이름에 올바르지 않은 문자가 있습니다.');
  if (!name || name.length > MAX_DOCUMENT_NAME)
    throw Error(`문서 이름을 1~${MAX_DOCUMENT_NAME}자로 입력해주세요.`);
  if (/[<>:"/\\|?*]/.test(name))
    throw Error('문서 이름에는 < > : " / \\ | ? * 문자를 사용할 수 없습니다.');
  if (name.startsWith('.') || name.endsWith('.') || name.includes('..'))
    throw Error(
      '문서 이름의 처음·끝에 점을 쓰거나 점을 연속해서 사용할 수 없습니다.',
    );
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name))
    throw Error('문서 이름에 Windows 예약 이름을 사용할 수 없습니다.');
  return name;
}

export function documentNamePath(
  relative: string,
  value: unknown,
  paths: Iterable<string>,
) {
  const name = documentName(value);
  if (
    !/^(?:docs|ideas)\/.+\.md$/.test(relative) ||
    /^(?:docs\/(?:html-sources|text-sources)\/)/.test(relative)
  )
    throw Error(
      '이 파일은 이름을 변경할 수 없습니다. 기존 프로젝트 문서는 파일 구조 정리 후 변경해주세요.',
    );
  const to = relative.slice(0, relative.lastIndexOf('/') + 1) + name + '.md';
  if (to.length > 240)
    throw Error('문서 경로가 너무 깁니다. 더 짧은 이름을 입력해주세요.');
  if (
    [...paths].some((p) => p !== relative && fileNameKey(p) === fileNameKey(to))
  )
    throw Error('같은 이름의 파일이 있습니다. 다른 이름을 입력해주세요.');
  return { name, to };
}

/** Creation can suggest a readable duplicate; manual rename must reject collisions. */
export function availableDocumentName(
  value: unknown,
  directory: string,
  paths: Iterable<string>,
  extension = '.md',
) {
  const name = documentName(value);
  const used = new Set([...paths].map(fileNameKey));
  let candidate = name;
  for (
    let number = 2;
    used.has(fileNameKey(`${directory}/${candidate}${extension}`));
    number++
  ) {
    const suffix = ` (${number})`;
    let stem = name;
    while (stem.length > MAX_DOCUMENT_NAME - suffix.length)
      stem = [...stem].slice(0, -1).join('');
    candidate = stem.trimEnd() + suffix;
  }
  return candidate;
}
