import type { Project } from '../project-state.ts';
import type { CollaborationEnvelope } from '../../contracts/collaboration.ts';
import { isDrawingPath, drawingDelta } from '../../drawing-model.ts';
/** Negotiate the existing v1 delta shape; retain full responses when history has a gap. */
export function projectResponse(
  current: Project | undefined,
  input: Record<string, unknown>,
  result: unknown,
): unknown {
  let output: unknown = result;
  if (
    current &&
    input.metadataOnly !== true &&
    input.deltaVersion === 1 &&
    Number.isSafeInteger(input.knownRevision) &&
    (result as CollaborationEnvelope)?.state &&
    Number(input.knownRevision) <= current.revision
  ) {
    const from = Number(input.knownRevision);
    const records = current.history.filter(
      (entry) => (entry.entry.revision ?? 0) > from,
    );
    if (
      from === current.revision ||
      (records.length && records[0].entry.revision === from + 1)
    ) {
      const changes: Record<string, string | null> = {};
      for (const record of records)
        for (const file of record.entry.files)
          changes[file.relativePath] = current.files[file.relativePath] ?? null;
      const relatives = Object.keys(changes);
      const drawings: Record<
        string,
        import('../../drawing-types.ts').DrawingDelta
      > = {};
      if (input.drawingsVersion === 1)
        for (const relative of relatives.filter(isDrawingPath)) {
          const first = records.find((r) =>
            r.entry.files.some((f) => f.relativePath === relative),
          );
          drawings[relative] = drawingDelta(
            relative,
            first?.before[relative],
            current.files[relative],
          );
          delete changes[relative];
        }
      output = {
        ...(result as object),
        files: undefined,
        revisions: Object.fromEntries(
          relatives.map((key) => [key, current.revisions[key]]),
        ),
        properties: Object.fromEntries(
          relatives.map((key) => [key, current.propertyVersions?.[key] ?? {}]),
        ),
        authorship: Object.fromEntries(
          relatives.map((key) => [key, current.authorship[key] ?? null]),
        ),
        delta: {
          from,
          changes,
          ...(Object.keys(drawings).length ? { drawings } : {}),
        },
      };
    }
  }
  return output;
}
