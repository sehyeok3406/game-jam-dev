import { assertWorkflowReferences } from './document-statuses-storage.ts';
import { DOCUMENT_STATUSES_PATH } from './document-statuses.ts';
import { mergeProperties } from './sync-properties.ts';
import type { Snapshot } from './project-store.ts';
import { assertRemovedImagesUnreferenced } from './asset-reference-safety.ts';

export type EditRecord = { id: string; label: string };

/** A session journal of this client's operations, never another member's history. */
export class EditJournal {
  undoStack: EditRecord[] = [];
  redoStack: EditRecord[] = [];
  push(record: EditRecord) {
    if (
      [...this.undoStack, ...this.redoStack].some(
        (item) => item.id === record.id,
      )
    )
      return;
    this.undoStack.push(record);
    this.undoStack = this.undoStack.slice(-100);
    this.redoStack = [];
  }
  get state() {
    return {
      undo: this.undoStack.at(-1)?.label ?? null,
      redo: this.redoStack.at(-1)?.label ?? null,
    };
  }
  peek(direction: 'undo' | 'redo') {
    const record = (direction === 'undo' ? this.undoStack : this.redoStack).at(
      -1,
    );
    if (!record) throw new Error('되돌릴 작업이 없습니다.');
    return record;
  }
  finish(direction: 'undo' | 'redo', id: string) {
    const source = direction === 'undo' ? this.undoStack : this.redoStack;
    if (source.at(-1)?.id !== id)
      throw new Error('작업 순서가 변경되었습니다.');
    const record = source.pop()!;
    (direction === 'undo' ? this.redoStack : this.undoStack).push(record);
  }
}

/** Compare only affected files; unrelated collaborators' changes remain untouched. */
export function invertEdit(
  current: Snapshot,
  before: Snapshot,
  after: Snapshot,
  direction: 'undo' | 'redo',
): Snapshot {
  if (direction !== 'undo' && direction !== 'redo')
    throw new Error('올바르지 않은 편집 방향입니다.');
  const expected = direction === 'undo' ? after : before;
  const desired = direction === 'undo' ? before : after;
  const touched = Object.keys({ ...before, ...after }).filter(
    (relative) => before[relative] !== after[relative],
  );
  if (!touched.length) throw new Error('되돌릴 파일 변경이 없습니다.');
  const next = { ...current };
  for (const relative of touched) {
    const value = mergeProperties(
      relative,
      expected[relative],
      desired[relative],
      current[relative],
    );
    if (value === undefined) delete next[relative];
    else next[relative] = value;
  }
  if (next[DOCUMENT_STATUSES_PATH] || current[DOCUMENT_STATUSES_PATH])
    assertWorkflowReferences(next);
  assertRemovedImagesUnreferenced(current, next);
  return next;
}
