import type { CanvasSection } from '../../contracts/canvas';
import type { CanvasDocument } from '../../contracts/documents';
import type { PreviewWindowState } from '../../contracts/preview';
import type { EditorApi } from '../../contracts/app-api';
import { selectionScopeKey, type SelectionScope } from './selection-actions.ts';

type DocumentTarget = Pick<
  CanvasDocument,
  'id' | 'relativePath' | 'title' | 'collapsed'
>;
const copyDocumentTarget = ({
  id,
  relativePath,
  title,
  collapsed,
}: DocumentTarget): DocumentTarget => ({ id, relativePath, title, collapsed });
export type CollapseTarget =
  | { kind: 'document'; document: DocumentTarget }
  | { kind: 'section'; section: CanvasSection; collapsed: boolean }
  | { kind: 'preview'; relativePath: string; windowState: PreviewWindowState }
  | {
      kind: 'kanban';
      collapsed: boolean;
      update: (collapsed: boolean) => void;
    };
export const sectionViewCollapsed = (
  id: string,
  views: Record<string, boolean>,
  finding: boolean,
  temporary: string[],
) => !!views[id] && !finding && !temporary.includes(id);
export const selectionShouldExpand = (targets: CollapseTarget[]) =>
  targets.some((target) =>
    target.kind === 'document'
      ? target.document.collapsed
      : target.kind === 'preview'
        ? target.windowState.collapsed
        : target.collapsed,
  );
type Guard = () => void;
export type CollapsePorts = {
  scope: SelectionScope;
  busy: boolean;
  canCollapse: (paths: string[]) => boolean;
  editor: Pick<EditorApi, 'setDocumentCollapsed'>;
  flush: (guard: Guard, mode: 'all' | 'editors') => Promise<void>;
  sectionViews: (ids: string[], collapsed: boolean) => void;
  clearTemporarySections: (ids?: string[]) => void;
  clearTemporaryDocument: (id: string) => void;
  selectCollapsedSection: (section: CanvasSection) => void;
  savePreview: (
    relative: string,
    state: PreviewWindowState,
    guard: Guard,
  ) => Promise<void>;
  reload: () => Promise<unknown>;
  notice: (message: string) => void;
  error: (error: unknown) => void;
};
class StaleCollapse extends Error {}
const pathsFor = (targets: CollapseTarget[]) =>
  targets.flatMap((target) =>
    target.kind === 'document'
      ? [target.document.relativePath]
      : target.kind === 'preview'
        ? [target.relativePath]
        : target.kind === 'section'
          ? [
              target.section.relativePath,
              ...target.section.members.map((member) => member.path),
            ]
          : [],
  );

/** Preserve each target's existing persistence policy; a mixed collapse is not an atomic file batch. */
export class CanvasCollapseActions {
  private running = new Set<string>();
  private disposed = false;
  private read: () => CollapsePorts;
  private busyChanged: (scope: SelectionScope, busy: boolean) => void;
  constructor(
    read: () => CollapsePorts,
    busyChanged: (scope: SelectionScope, busy: boolean) => void,
  ) {
    this.read = read;
    this.busyChanged = busyChanged;
  }
  private async run(
    paths: string[],
    operation: (ports: CollapsePorts, guard: Guard) => Promise<void>,
  ) {
    const ports = this.read(),
      scope = { ...ports.scope },
      key = selectionScopeKey(scope);
    if (
      this.disposed ||
      scope.home ||
      !scope.root ||
      ports.busy ||
      this.running.has(key) ||
      !ports.canCollapse(paths)
    )
      return;
    const guard = () => {
      if (this.disposed || selectionScopeKey(this.read().scope) !== key)
        throw new StaleCollapse();
    };
    this.running.add(key);
    this.busyChanged(scope, true);
    try {
      await operation(ports, () => {
        guard();
        if (!this.read().canCollapse(paths)) throw new StaleCollapse();
      });
    } catch (error) {
      if (
        !(error instanceof StaleCollapse) &&
        !this.disposed &&
        selectionScopeKey(this.read().scope) === key
      )
        ports.error(error);
    } finally {
      this.running.delete(key);
      this.busyChanged(scope, false);
    }
  }
  document(
    document: DocumentTarget,
    options: { temporary?: boolean; menu?: boolean } = {},
    acknowledge: () => void = () => {},
  ) {
    const target = copyDocumentTarget(document),
      settings = { ...options };
    return this.run([target.relativePath], async (ports, guard) => {
      guard();
      if (settings.temporary) {
        ports.clearTemporaryDocument(target.id);
        return;
      }
      await ports.editor.setDocumentCollapsed({
        relativePath: target.relativePath,
        collapsed: !target.collapsed,
      });
      guard();
      acknowledge();
      await ports.reload();
      guard();
      if (settings.menu)
        ports.notice(
          `'${target.title}' 파일을 ${target.collapsed ? '펼쳤습니다.' : '최소화했습니다.'}`,
        );
    });
  }
  section(section: CanvasSection, effectiveCollapsed: boolean) {
    const target = structuredClone(section),
      collapsed = !effectiveCollapsed;
    return this.run(
      pathsFor([
        { kind: 'section', section: target, collapsed: effectiveCollapsed },
      ]),
      async (ports, guard) => {
        await ports.flush(guard, 'editors');
        guard();
        ports.sectionViews([target.id], collapsed);
        ports.clearTemporarySections([target.id]);
        if (collapsed) ports.selectCollapsedSection(target);
      },
    );
  }
  selection(input: CollapseTarget[]) {
    const targets = input.map((target) =>
      target.kind === 'kanban'
        ? { ...target }
        : target.kind === 'document'
          ? {
              kind: 'document' as const,
              document: copyDocumentTarget(target.document),
            }
          : structuredClone(target),
    );
    const collapsed = !selectionShouldExpand(targets);
    return this.run(pathsFor(targets), async (ports, guard) => {
      await ports.flush(guard, 'all');
      guard();
      let sectionsApplied = false;
      for (const target of targets) {
        guard();
        if (target.kind === 'kanban') target.update(collapsed);
        if (target.kind === 'section' && !sectionsApplied) {
          ports.sectionViews(
            targets.flatMap((item) =>
              item.kind === 'section' ? [item.section.id] : [],
            ),
            collapsed,
          );
          ports.clearTemporarySections();
          sectionsApplied = true;
        }
        if (target.kind === 'document')
          await ports.editor.setDocumentCollapsed({
            relativePath: target.document.relativePath,
            collapsed,
          });
        if (target.kind === 'preview')
          await ports.savePreview(
            target.relativePath,
            { ...target.windowState, collapsed },
            guard,
          );
        guard();
      }
      await ports.reload();
      guard();
    });
  }
  activate() {
    this.disposed = false;
  }
  dispose() {
    this.disposed = true;
  }
}
