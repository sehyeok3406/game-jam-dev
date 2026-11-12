import type { CanvasSection } from '../../contracts/canvas.ts';

export function sectionTree(sections: readonly CanvasSection[]) {
  const byId = new Map(sections.map((section) => [section.id, section]));
  const parents = new Map<string, CanvasSection>();
  const invalid = new Set<string>();
  for (const section of sections) {
    if (section.parentSectionId === undefined) continue;
    const parent = byId.get(section.parentSectionId);
    if (
      parent &&
      (parent.canvasId || 'default') === (section.canvasId || 'default')
    )
      parents.set(section.id, parent);
    else invalid.add(section.id);
  }
  const visited = new Set<string>();
  for (const section of sections) {
    const chain = new Set<string>();
    let id: string | undefined = section.id;
    while (id !== undefined && !visited.has(id)) {
      if (chain.has(id)) {
        let cycle: string = id;
        do {
          invalid.add(cycle);
          cycle = parents.get(cycle)!.id;
        } while (cycle !== id);
        break;
      }
      chain.add(id);
      id = parents.get(id)?.id;
    }
    for (const item of chain) visited.add(item);
  }
  for (const id of invalid) parents.delete(id);
  const children = new Map<string, CanvasSection[]>();
  for (const section of sections) {
    const parent = parents.get(section.id);
    if (parent) {
      const siblings = children.get(parent.id) ?? [];
      siblings.push(section);
      children.set(parent.id, siblings);
    }
  }
  return { parents, children, invalid };
}

export type SectionTree = ReturnType<typeof sectionTree>;

export function sectionBranch(tree: SectionTree, root: CanvasSection) {
  const branch = [root];
  for (let index = 0; index < branch.length; index++)
    branch.push(...(tree.children.get(branch[index].id) ?? []));
  return branch;
}

export function sectionAncestors(tree: SectionTree, id: string) {
  const result: CanvasSection[] = [];
  for (
    let parent = tree.parents.get(id);
    parent;
    parent = tree.parents.get(parent.id)
  )
    result.push(parent);
  return result;
}

export function sectionDeletionPaths(
  tree: SectionTree,
  section: CanvasSection,
  deleteMembers: boolean,
) {
  if (!deleteMembers)
    return [
      ...new Set([
        section.relativePath,
        ...(tree.children.get(section.id) ?? []).map(
          (child) => child.relativePath,
        ),
        ...section.members.map((member) => member.path),
      ]),
    ];
  return [
    ...new Set(
      sectionBranch(tree, section).flatMap((child) => [
        child.relativePath,
        ...child.members.map((member) => member.path),
      ]),
    ),
  ];
}

export function fitChildSections(
  frame: Pick<CanvasSection, 'x' | 'y' | 'width' | 'height'>,
  children: readonly CanvasSection[],
) {
  let { x, y } = frame;
  let right = x + frame.width;
  let bottom = y + frame.height;
  for (const child of children) {
    x = Math.min(x, child.x - 48);
    y = Math.min(y, child.y - 72);
    right = Math.max(right, child.x + child.width + 48);
    bottom = Math.max(bottom, child.y + child.height + 48);
  }
  return { x, y, width: right - x, height: bottom - y };
}
