/** Compare decoded DTOs at the read boundary, without serializing their payloads. */
function sameData(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object')
    return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameData(value, right[index]))
    );
  }
  if (
    Object.getPrototypeOf(left) !== Object.prototype ||
    Object.getPrototypeOf(right) !== Object.prototype
  )
    return false;
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameData(a[key], b[key]))
  );
}

/** Immutable DTO reads retain unchanged records and, when possible, the list itself. */
export function retainUnchangedRecords<T extends { id: string }>(
  previous: T[],
  received: T[],
): T[] {
  const existing = new Map(previous.map((record) => [record.id, record]));
  const next = received.map((record) => {
    const old = existing.get(record.id);
    return old && sameData(old, record) ? old : record;
  });
  return next.length === previous.length &&
    next.every((record, index) => record === previous[index])
    ? previous
    : next;
}
