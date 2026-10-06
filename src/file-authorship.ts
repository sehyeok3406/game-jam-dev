import { createHash } from 'node:crypto';
import matter from './markdown.ts';
import type { Snapshot } from './project-store.ts';
import type {
  FileActor,
  FileAuthorship,
  FileAuthorshipMap,
  HistoryEntry,
} from './shared.ts';

export const LOCAL_ACTOR: FileActor = { name: '로컬 사용자', kind: 'local' };
const hash = (content: string) =>
  createHash('sha256').update(content).digest('hex');
const fileId = (relative: string, content: string) => {
  if (relative.endsWith('.md')) {
    try {
      const id = matter(content).data.id;
      if (typeof id === 'string') return id;
    } catch {
      /* Invalid/external documents never supply attribution themselves. */
    }
  }
  return relative;
};
const restoring = (entry: HistoryEntry) =>
  entry.kind === 'restore' || /^(실행 취소|다시 실행)/.test(entry.label);

export function historyActor(entry: HistoryEntry): FileActor {
  return {
    ...(entry.actorId ? { id: entry.actorId } : {}),
    name: entry.actorName ?? LOCAL_ACTOR.name,
    kind: entry.kind === 'ai' ? 'ai' : entry.actorName ? 'member' : 'local',
  };
}

/** Called only for authoritative committed changes, never renderer author fields. */
export function advanceAuthorship(
  current: FileAuthorshipMap,
  before: Snapshot,
  after: Snapshot,
  entry: HistoryEntry,
): FileAuthorshipMap {
  const next = { ...current };
  if (entry.status !== 'completed') return next;
  const actor = historyActor(entry),
    time = entry.finishedAt ?? entry.createdAt;
  for (const [relative, content] of Object.entries(after)) {
    if (before[relative] === content) continue;
    const identity = fileId(relative, content);
    const previous =
      current[relative]?.fileId === identity ? current[relative] : undefined;
    const newlyCreated = before[relative] === undefined && !restoring(entry);
    next[relative] = {
      ...previous,
      fileId: identity,
      contentHash: hash(content),
      createdBy: previous?.createdBy ?? (newlyCreated ? actor : undefined),
      createdAt: previous?.createdAt ?? (newlyCreated ? time : undefined),
      lastEditedBy: actor,
      lastEditedAt: time,
    };
  }
  // Retain identities of deleted files so restoration does not invent a creator.
  return next;
}

export function rebuildAuthorship(
  records: { entry: HistoryEntry; before: Snapshot; after: Snapshot }[],
) {
  return records.reduce(
    (ledger, record) =>
      advanceAuthorship(ledger, record.before, record.after, record.entry),
    {} as FileAuthorshipMap,
  );
}

/** External edits invalidate only the last-editor claim, not a known creator. */
export function resolveAuthorship(
  ledger: FileAuthorshipMap,
  relative: string,
  content: string,
): FileAuthorship {
  const record = ledger[relative];
  if (!record || record.fileId !== fileId(relative, content)) return {};
  const matches = record.contentHash === hash(content);
  return {
    createdBy: record.createdBy,
    createdAt: record.createdAt,
    lastEditedBy: matches ? record.lastEditedBy : undefined,
    lastEditedAt: matches ? record.lastEditedAt : undefined,
  };
}
