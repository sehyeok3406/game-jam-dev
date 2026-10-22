import type { SectionMember } from '../../contracts/canvas.ts';

export const normalizeSectionMembers = (value: unknown): SectionMember[] => {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  return value.flatMap((member) => {
    if (!member || typeof member !== 'object') return [];
    const record = member as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.path !== 'string')
      return [];
    const memberPath = record.path.replaceAll('\\', '/');
    if (seenIds.has(record.id) || seenPaths.has(memberPath)) return [];
    seenIds.add(record.id);
    seenPaths.add(memberPath);
    return [{ id: record.id, path: memberPath }];
  });
};
