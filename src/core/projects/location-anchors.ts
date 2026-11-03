export const LOCATION_ANCHOR_PATTERN = /<!--gamejam:block:([a-f0-9-]{36})-->/g;
export function locationAnchorIds(markdown: string): string[] {
  return [...markdown.matchAll(LOCATION_ANCHOR_PATTERN)].map(
    (match) => match[1],
  );
}
export function validLocationAnchor(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
  );
}
export function textLocationAnchorIds(raw: string): string[] {
  const result: string[] = [];
  const visit = (node: {
    type?: string;
    attrs?: { id?: unknown };
    content?: (typeof node)[];
  }) => {
    if (node.type === 'locationAnchor' && validLocationAnchor(node.attrs?.id))
      result.push(node.attrs.id);
    node.content?.forEach(visit);
  };
  visit(JSON.parse(raw));
  return result;
}
