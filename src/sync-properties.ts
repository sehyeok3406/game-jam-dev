import type { PropertyVersions } from './contracts/sync-properties.ts';
export type { PropertyVersions } from './contracts/sync-properties.ts';
import type { PropertyGroup } from './contracts/sync-properties.ts';
export type { PropertyGroup } from './contracts/sync-properties.ts';
import { propertyKeys } from './contracts/sync-properties.ts';
export { propertyKeys } from './contracts/sync-properties.ts';
import { DOCUMENT_STATUSES_PATH } from './document-statuses.ts';
import { mergeStatuses } from './document-statuses-storage.ts';
import matter from './markdown.ts';
import { isDrawingPath, mergeDrawingFile } from './drawing-model.ts';
import { isGameUiPath, mergeGameUi } from './game-ui-model.ts';
import type { Snapshot } from './project-store.ts';
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function propertyValues(raw: string) {
  const parsed = matter(raw);
  const structure = { ...parsed.data };
  delete structure.updated_at;
  for (const keys of Object.values(propertyKeys))
    for (const key of keys) delete structure[key];
  return {
    content: [parsed.data.title, parsed.content],
    position: [parsed.data.x, parsed.data.y],
    size: [parsed.data.width, parsed.data.height, parsed.data.collapsed],
    color: [parsed.data.background_color],
    workflow: [
      parsed.data.workflow_status_id,
      parsed.data.workflow_order,
      parsed.data.status_property_enabled,
    ],
    structure,
  };
}
export function changedGroups(
  relative: string,
  before?: string,
  after?: string,
): PropertyGroup[] {
  if (!relative.endsWith('.md') || before === undefined || after === undefined)
    return ['structure'];
  const b = propertyValues(before),
    a = propertyValues(after);
  return (Object.keys(b) as PropertyGroup[]).filter(
    (key) => !same(b[key], a[key]),
  );
}
/** Existing HTML metadata may sync its status property, but never source/identity/body changes. */
export function workflowOnlyChange(
  relative: string,
  before?: string,
  after?: string,
) {
  if (before === undefined || after === undefined) return false;
  const groups = changedGroups(relative, before, after);
  return groups.length > 0 && groups.every((group) => group === 'workflow');
}
export function objectId(raw?: string): string | undefined {
  return raw === undefined ? undefined : String(matter(raw).data.id ?? '');
}
/** Conditional group inverse/merge: title and body, xy, and wh never split. */
export function mergeProperties(
  relative: string,
  expected?: string,
  desired?: string,
  current?: string,
) {
  if (relative === DOCUMENT_STATUSES_PATH)
    return mergeStatuses(expected, desired, current);
  if (isDrawingPath(relative))
    return mergeDrawingFile(relative, expected, desired, current, true);
  if (isGameUiPath(relative))
    return mergeGameUi(expected, desired, current, true);
  if (current === expected) return desired;
  if (
    expected === undefined ||
    desired === undefined ||
    current === undefined ||
    !relative.endsWith('.md')
  )
    throw new Error(
      `이후 변경과 충돌하여 덮어쓰기를 중단했습니다: ${relative}`,
    );
  const groups = changedGroups(relative, expected, desired);
  if (groups.includes('structure'))
    throw new Error(`구조 변경과 충돌했습니다: ${relative}`);
  const e = propertyValues(expected),
    c = propertyValues(current),
    d = propertyValues(desired);
  if (!same(e.structure, c.structure))
    throw new Error(`문서 소속 또는 ID가 변경되었습니다: ${relative}`);
  const result = matter(current),
    target = matter(desired);
  for (const group of groups) {
    if (!same(e[group], c[group]) && !same(d[group], c[group]))
      throw new Error(
        `같은 속성의 이후 변경과 충돌했습니다: ${relative} (${group})`,
      );
    for (const key of propertyKeys[group as keyof typeof propertyKeys]) {
      if (target.data[key] === undefined) delete result.data[key];
      else result.data[key] = target.data[key];
    }
    if (group === 'content') result.content = target.content;
  }
  return matter.stringify(result.content, {
    ...result.data,
    updated_at: Date.now(),
  });
}
export function advanceProperties(
  versions: PropertyVersions,
  before: Snapshot,
  after: Snapshot,
  revision: number,
) {
  const next = { ...versions };
  for (const relative of Object.keys({ ...before, ...after })) {
    if (before[relative] === after[relative]) continue;
    const value = { ...next[relative] };
    for (const group of changedGroups(
      relative,
      before[relative],
      after[relative],
    ))
      value[group] = revision;
    next[relative] = value;
  }
  return next;
}
