import type { EditorApi } from '../../contracts/app-api';
import type { CanvasSection, CreateSectionInput } from '../../contracts/canvas';
import type { CanvasDocument } from '../../contracts/documents';
import { selectionScopeKey, type SelectionScope } from './selection-actions.ts';

export type SectionActionPrompt = {
  section: CanvasSection;
  deleteMembers: boolean;
};
export type MembershipPrompt = {
  document: CanvasDocument;
  fromSection: CanvasSection | null;
  toSection: CanvasSection | null;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type SectionCreatePrompt = {
  title: string;
  documents: CanvasDocument[];
};
export type SectionRenamePrompt = { section: CanvasSection; title: string };

/** Preserve the existing expanded-document bounds and minimum section size. */
export function sectionCreationInput(
  documents: CanvasDocument[],
  title: string,
  canvasId: string,
): CreateSectionInput | null {
  if (!documents.length) return null;
  const minX = Math.min(...documents.map((doc) => doc.x));
  const minY = Math.min(...documents.map((doc) => doc.y));
  const maxX = Math.max(...documents.map((doc) => doc.x + doc.width));
  const maxY = Math.max(...documents.map((doc) => doc.y + doc.height));
  return {
    canvasId,
    title: title.trim() || '새 섹션',
    x: minX - 48,
    y: minY - 72,
    width: Math.max(maxX - minX + 96, 420),
    height: Math.max(maxY - minY + 120, 280),
    members: documents.map((doc) => ({ id: doc.id, path: doc.relativePath })),
  };
}
type Guard = () => void;
export type SectionActionPorts = {
  scope: SelectionScope;
  editor: Pick<
    EditorApi,
    | 'createSection'
    | 'deleteSection'
    | 'moveDocumentToSection'
    | 'renameSection'
  >;
  busy: boolean;
  canEdit: (paths: string[]) => boolean;
  reload: () => Promise<unknown>;
  notice: (message: string) => void;
  error: (error: unknown) => void;
};
class StaleSection extends Error {}

/** UI acknowledgement belongs to the originating view; native/server persistence stays unchanged. */
export class CanvasSectionActions {
  private running = new Set<string>();
  private disposed = false;
  private read: () => SectionActionPorts;
  private busyChanged: (scope: SelectionScope, busy: boolean) => void;
  constructor(
    read: () => SectionActionPorts,
    busyChanged: (scope: SelectionScope, busy: boolean) => void,
  ) {
    this.read = read;
    this.busyChanged = busyChanged;
  }
  private async run(
    paths: string[] | null,
    operation: (ports: SectionActionPorts, guard: Guard) => Promise<void>,
  ) {
    const ports = this.read(),
      scope = { ...ports.scope },
      key = selectionScopeKey(scope);
    if (
      this.disposed ||
      scope.home ||
      !scope.root ||
      ports.busy ||
      this.running.has(key)
    )
      return;
    const guard = () => {
      if (this.disposed || selectionScopeKey(this.read().scope) !== key)
        throw new StaleSection();
    };
    if (paths && !ports.canEdit(paths)) return;
    this.running.add(key);
    this.busyChanged(scope, true);
    try {
      guard();
      // Re-read current permissions at publication; no await may separate it from the IPC.
      if (paths && !this.read().canEdit(paths)) return;
      await operation(ports, guard);
    } catch (error) {
      if (
        !(error instanceof StaleSection) &&
        !this.disposed &&
        selectionScopeKey(this.read().scope) === key
      )
        ports.error(error);
    } finally {
      this.running.delete(key);
      this.busyChanged(scope, false);
    }
  }
  create(
    prompt: SectionCreatePrompt,
    acknowledge: (section: CanvasSection) => void,
  ) {
    const input = sectionCreationInput(
      prompt.documents,
      prompt.title,
      this.read().scope.canvasId,
    );
    if (!input) {
      this.read().notice('섹션으로 묶을 문서를 하나 이상 선택하세요.');
      return Promise.resolve();
    }
    return this.run(
      input.members.map((member) => member.path),
      async (ports, guard) => {
        const section = await ports.editor.createSection(input);
        guard();
        await ports.reload();
        guard();
        acknowledge(section);
        ports.notice(
          `'${section.title}' 섹션에 ${section.members.length}개 파일을 묶었습니다.`,
        );
      },
    );
  }
  remove(prompt: SectionActionPrompt, acknowledge: () => void) {
    const { section, deleteMembers } = structuredClone(prompt);
    return this.run(
      [section.relativePath, ...section.members.map((member) => member.path)],
      async (ports, guard) => {
        let result;
        try {
          result = await ports.editor.deleteSection({
            sectionId: section.id,
            relativePath: section.relativePath,
            revision: section.revision,
            deleteMembers,
          });
        } catch (error) {
          guard();
          acknowledge();
          throw error;
        }
        guard();
        acknowledge();
        await ports.reload();
        guard();
        ports.notice(
          deleteMembers
            ? `'${section.title}' 섹션과 파일 ${result.deletedDocumentCount}개를 휴지통으로 이동했습니다.`
            : `'${section.title}' 섹션을 해제했습니다. 파일 ${section.members.length}개는 그대로 유지됩니다.`,
        );
      },
    );
  }
  rename(prompt: SectionRenamePrompt, acknowledge: () => void) {
    const { relativePath, revision } = prompt.section;
    const title = prompt.title;
    if (!title.trim()) return Promise.resolve();
    return this.run([relativePath], async (ports, guard) => {
      await ports.editor.renameSection(relativePath, title, revision);
      guard();
      acknowledge();
      await ports.reload();
      guard();
    });
  }
  membership(
    prompt: MembershipPrompt,
    acknowledge: () => void,
    cancel = false,
  ) {
    const { document, fromSection, toSection, x, y, width, height } =
      structuredClone(prompt);
    const paths = cancel
      ? null
      : [
          document.relativePath,
          ...[fromSection, toSection].flatMap((section) =>
            section ? [section.relativePath] : [],
          ),
        ];
    return this.run(paths, async (ports, guard) => {
      if (!cancel) {
        try {
          await ports.editor.moveDocumentToSection({
            documentId: document.id,
            documentPath: document.relativePath,
            revision: document.revision,
            targetSectionId: toSection?.id ?? null,
            x,
            y,
            width,
            height,
          });
        } catch (error) {
          guard();
          acknowledge();
          ports.error(error);
          await ports.reload();
          guard();
          return;
        }
        guard();
      }
      acknowledge();
      await ports.reload();
      guard();
      if (cancel)
        ports.notice('섹션 변경을 취소하고 파일을 원래 위치로 되돌렸습니다.');
      else if (fromSection && toSection)
        ports.notice(
          `'${document.title}' 파일을 '${fromSection.title}'에서 '${toSection.title}' 섹션으로 옮겼습니다.`,
        );
      else if (toSection)
        ports.notice(
          `'${document.title}' 파일을 '${toSection.title}' 섹션에 추가했습니다.`,
        );
      else if (fromSection)
        ports.notice(
          `'${document.title}' 파일을 '${fromSection.title}' 섹션에서 제외했습니다.`,
        );
    });
  }
  activate() {
    this.disposed = false;
  }
  dispose() {
    this.disposed = true;
  }
}
