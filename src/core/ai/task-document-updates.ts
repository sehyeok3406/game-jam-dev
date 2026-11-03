import type { Snapshot } from '../../contracts/project.ts';
import type { TaskDocumentUpdatesV1 } from '../../contracts/task-instructions.ts';

type Read = (raw: string) => { data: Record<string, unknown> };

/** Output scope alone never authorizes overwriting an input idea. */
export function taskDocumentUpdates(
  value: unknown,
  inputs: readonly string[],
  outputs: readonly string[],
): TaskDocumentUpdatesV1 | undefined {
  if (value === undefined) {
    if (outputs.some((p) => inputs.includes(p)))
      throw Error('입력 문서 갱신 대상을 명시해주세요.');
    return undefined;
  }
  const v = value as TaskDocumentUpdatesV1;
  if (
    !v ||
    v.version !== 1 ||
    !Array.isArray(v.targets) ||
    !v.targets.length ||
    v.targets.length > 64 ||
    Object.keys(v).some((k) => !['version', 'targets'].includes(k)) ||
    new Set(v.targets.map((t) => t?.path)).size !== v.targets.length ||
    v.targets.some(
      (t) =>
        !t ||
        Object.keys(t).some((k) => !['path', 'id'].includes(k)) ||
        typeof t.path !== 'string' ||
        !/^docs\/.+\.md$/.test(t.path) ||
        t.path.includes('..') ||
        t.path.includes('\\') ||
        !outputs.includes(t.path) ||
        typeof t.id !== 'string' ||
        !t.id.trim(),
    ) ||
    outputs.some(
      (p) => inputs.includes(p) && !v.targets.some((t) => t.path === p),
    )
  )
    throw Error('시스템 문서 갱신 범위가 올바르지 않습니다.');
  return v;
}

export function assertDocumentUpdateBaseline(
  updates: TaskDocumentUpdatesV1 | undefined,
  files: Snapshot,
  read: Read,
) {
  for (const target of updates?.targets ?? []) {
    const data = files[target.path] && read(files[target.path]).data;
    if (
      !data ||
      data.id !== target.id ||
      !['system', 'overview', 'question'].includes(String(data.type))
    )
      throw Error(
        `갱신할 시스템 문서가 변경되거나 삭제되었습니다: ${target.path}`,
      );
  }
}
