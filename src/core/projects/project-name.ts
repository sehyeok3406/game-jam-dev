export const MAX_PROJECT_NAME = 100;

/** Project names become directory names; validate the name that will be saved. */
export function projectDirectoryName(value: unknown): string {
  if (typeof value !== 'string')
    throw new Error('프로젝트 이름은 텍스트로 입력해주세요.');
  if ([...value].some((char) => char.charCodeAt(0) < 32))
    throw new Error(
      '프로젝트 이름에는 줄바꿈·탭 등 제어 문자를 사용할 수 없습니다.',
    );
  const name = value.trim().normalize('NFC');
  if (!name || name.length > MAX_PROJECT_NAME)
    throw new Error(`프로젝트 이름을 1~${MAX_PROJECT_NAME}자로 입력해주세요.`);
  if (/[<>:"/\\|?*]/.test(name))
    throw new Error(
      '프로젝트 이름에는 < > : " / \\ | ? * 문자를 사용할 수 없습니다.',
    );
  if (name.endsWith('.'))
    throw new Error('프로젝트 이름은 점(.)으로 끝날 수 없습니다.');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
    throw new Error(
      '프로젝트 이름에 Windows 예약 이름(CON, PRN, AUX, NUL, COM1~9, LPT1~9)을 사용할 수 없습니다.',
    );
  return name;
}

/** Comparison is independent of the user's current locale and storage parent. */
export const projectNameKey = (name: string) =>
  name.trim().normalize('NFC').toLowerCase();

export function assertProjectNameAvailable(
  entries: Iterable<{
    id: string;
    name: string;
    lifecycle?: { status: string };
  }>,
  name: string,
  exceptId?: string,
) {
  const key = projectNameKey(name);
  for (const entry of entries)
    if (
      entry.id !== exceptId &&
      (!entry.lifecycle ||
        ['active', 'restoring', 'trashing'].includes(entry.lifecycle.status)) &&
      projectNameKey(entry.name) === key
    )
      throw Object.assign(
        Error('같은 이름의 프로젝트가 있습니다. 다른 이름을 입력해주세요.'),
        { code: 'GC-PROJECT-NAME-CONFLICT' },
      );
}
