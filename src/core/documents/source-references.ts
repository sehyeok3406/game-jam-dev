import type { SourceReference } from '../../contracts/documents.ts';
export const normalizeSources = (value: unknown): SourceReference[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((source) => {
    if (typeof source === 'string') return [{ id: source }];
    if (!source || typeof source !== 'object') return [];
    const record = source as Record<string, unknown>;
    if (typeof record.id !== 'string') return [];
    return [
      {
        id: record.id,
        path: typeof record.path === 'string' ? record.path : undefined,
        contribution:
          typeof record.contribution === 'string'
            ? record.contribution
            : undefined,
      },
    ];
  });
};
