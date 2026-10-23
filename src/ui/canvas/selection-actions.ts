import type { EditorApi, PreviewApi } from '../../contracts/app-api';
import type { CanvasDocument } from '../../contracts/documents';
import type {
  DrawingCommand,
  DrawingObject,
} from '../../contracts/drawing-types';
import type { CommandEnvironment } from '../../core/editing/environment';
import { isPreviewPath } from '../../preview-output.ts';
import {
  arrangeSelectionItems,
  copyDrawingObjects,
  type ArrangementAction,
  type ArrangementItem,
  type DeletionItem,
  type SelectionTargets,
} from './selection-plan.ts';

export type SelectionScope = {
  root: string | null;
  saveScope?: string;
  sessionId?: string;
  epoch?: number;
  viewEpoch?: number;
  canvasId: string;
  home: boolean;
};
export const selectionScopeKey = (scope: SelectionScope) =>
  JSON.stringify([
    scope.root,
    scope.saveScope,
    scope.sessionId,
    scope.epoch,
    scope.canvasId,
    scope.home,
    scope.viewEpoch,
  ]);
type Guard = () => void;
export type SelectionActionPorts = {
  scope: SelectionScope;
  editor: Pick<
    EditorApi,
    | 'duplicateDocuments'
    | 'deleteDocument'
    | 'deleteDocuments'
    | 'listDocuments'
    | 'applyCanvasCommands'
    | 'updateLayouts'
  >;
  preview: Pick<PreviewApi, 'listPreviews'>;
  environment: CommandEnvironment;
  busy: boolean;
  canEdit: (paths: string[]) => boolean;
  flush: (guard: Guard) => Promise<void>;
  flushDrawings: () => Promise<void>;
  reloadDrawings: () => Promise<void>;
  submitDrawing: (command: DrawingCommand) => void;
  reload: () => Promise<unknown>;
  notice: (message: string) => void;
  error: (error: unknown) => void;
};
class StaleSelection extends Error {}

/** UI command ordering/acknowledgement; persistence and atomicity stay in existing IPC/services. */
export class CanvasSelectionActions {
  private read: () => SelectionActionPorts;
  private busyChanged: (scope: SelectionScope, busy: boolean) => void;
  private running = new Set<string>();
  private disposed = false;
  constructor(
    read: () => SelectionActionPorts,
    busyChanged: (scope: SelectionScope, busy: boolean) => void,
  ) {
    this.read = read;
    this.busyChanged = busyChanged;
  }
  private async run(
    paths: string[],
    operation: (
      ports: SelectionActionPorts,
      guard: Guard,
      writable: Guard,
      scope: SelectionScope,
    ) => Promise<void>,
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
        throw new StaleSelection();
    };
    const writable = () => {
      guard();
      if (!this.read().canEdit(paths)) throw new StaleSelection();
    };
    if (!ports.canEdit(paths)) return;
    this.running.add(key);
    this.busyChanged(scope, true);
    try {
      await operation(ports, guard, writable, scope);
    } catch (error) {
      if (
        !(error instanceof StaleSelection) &&
        !this.disposed &&
        selectionScopeKey(this.read().scope) === key
      )
        ports.error(error);
    } finally {
      this.running.delete(key);
      this.busyChanged(scope, false);
    }
  }
  private async batch(
    ports: SelectionActionPorts,
    scope: SelectionScope,
    commands: { channel: string; input: unknown }[],
    guard: Guard,
    writable: Guard,
  ) {
    await ports.flushDrawings();
    writable();
    const result = await ports.editor.applyCanvasCommands({
      scope: scope.saveScope!,
      commands,
    });
    guard();
    await ports.reloadDrawings();
    guard();
    return result;
  }
  duplicate(
    documents: DeletionItem[],
    drawings: DrawingObject[],
    acknowledge: (result: {
      created: CanvasDocument[];
      copies: DrawingObject[];
    }) => void,
  ) {
    const targets = {
      documents: documents.map(({ id, relativePath }) => ({
        id,
        relativePath,
      })),
      drawings: structuredClone(drawings),
    };
    return this.run([], async (ports, guard, writable, scope) => {
      await ports.flush(guard);
      writable();
      const input = {
        documents: targets.documents.map((doc) => ({
          id: doc.id,
          path: doc.relativePath,
        })),
        offsetX: 56,
        offsetY: 56,
      };
      const copies = copyDrawingObjects(
        targets.drawings,
        targets.documents.length ? 56 : 32,
        ports.environment,
      );
      if (!targets.documents.length) {
        if (copies.length)
          ports.submitDrawing({
            canvasId: scope.canvasId,
            action: 'create',
            objects: copies,
          });
        return;
      }
      const created = copies.length
        ? ((
            await this.batch(
              ports,
              scope,
              [
                { channel: 'documents:duplicate', input },
                {
                  channel: 'drawings:apply',
                  input: {
                    canvasId: scope.canvasId,
                    action: 'create',
                    objects: copies,
                  },
                },
              ],
              guard,
              writable,
            )
          )[0] as CanvasDocument[])
        : await ports.editor.duplicateDocuments(input);
      guard();
      await ports.reload();
      guard();
      acknowledge({ created, copies });
      ports.notice(`${created.length}개 문서를 복제했습니다.`);
    });
  }
  deleteOne(
    document: DeletionItem,
    acknowledge: () => void,
    failed: () => void,
  ) {
    const target = {
      id: document.id,
      relativePath: document.relativePath,
      title: document.title,
    };
    return this.run([target.relativePath], async (ports, guard, writable) => {
      try {
        await ports.flush(guard);
        writable();
        const current = isPreviewPath(target.relativePath)
          ? await ports.preview.listPreviews()
          : await ports.editor.listDocuments();
        writable();
        await ports.editor.deleteDocument({
          documentId: target.id,
          relativePath: target.relativePath,
          revision: current.find(
            (item) => item.relativePath === target.relativePath,
          )?.revision,
        });
        guard();
        acknowledge();
        await ports.reload();
        guard();
        ports.notice(
          `'${target.title}'${isPreviewPath(target.relativePath) ? ' HTML 결과와 관련 파일' : ' 파일'}을 휴지통으로 이동했습니다.`,
        );
      } catch (error) {
        guard();
        if (!(error instanceof StaleSelection)) failed();
        throw error;
      }
    });
  }
  deleteMany(input: SelectionTargets, acknowledge: () => void) {
    const targets = {
      documents: input.documents.map(({ id, relativePath }) => ({
        id,
        relativePath,
      })),
      sections: structuredClone(input.sections),
      drawings: structuredClone(input.drawings),
    };
    return this.run(
      [
        ...targets.documents.map((doc) => doc.relativePath),
        ...targets.sections.flatMap((section) => [
          section.relativePath,
          ...section.members.map((member) => member.path),
        ]),
      ],
      async (ports, guard, writable, scope) => {
        await ports.flush(guard);
        writable();
        const [documents, previews] = await Promise.all([
          ports.editor.listDocuments(),
          ports.preview.listPreviews(),
        ]);
        writable();
        const deletions = targets.documents.map((doc) => ({
          documentId: doc.id,
          relativePath: doc.relativePath,
          revision: [...documents, ...previews].find(
            (item) => item.relativePath === doc.relativePath,
          )?.revision,
        }));
        if (targets.drawings.length || targets.sections.length)
          await this.batch(
            ports,
            scope,
            [
              ...(deletions.length
                ? [
                    {
                      channel: 'documents:delete-many',
                      input: { documents: deletions },
                    },
                  ]
                : []),
              ...targets.sections.map((section) => ({
                channel: 'sections:delete',
                input: {
                  sectionId: section.id,
                  relativePath: section.relativePath,
                  deleteMembers: true,
                },
              })),
              ...(targets.drawings.length
                ? [
                    {
                      channel: 'drawings:apply',
                      input: {
                        canvasId: scope.canvasId,
                        action: 'delete',
                        targets: targets.drawings.map((object) => ({
                          id: object.id,
                          generation: object.generation,
                        })),
                      },
                    },
                  ]
                : []),
            ],
            guard,
            writable,
          );
        else await ports.editor.deleteDocuments(deletions);
        guard();
        acknowledge();
        await ports.reload();
        guard();
        ports.notice(
          '선택한 파일·HTML 결과와 관련 파일을 휴지통으로 이동했습니다.',
        );
      },
    );
  }
  arrange(
    items: ArrangementItem[],
    action: ArrangementAction,
    paths: string[],
  ) {
    const targets = structuredClone(items);
    return this.run(paths, async (ports, guard, writable) => {
      if (targets.length < 2) return;
      if (
        (action === 'distribute-x' || action === 'distribute-y') &&
        targets.length < 3
      ) {
        ports.notice('동일 간격 배치에는 3개 이상의 항목이 필요합니다.');
        return;
      }
      const updates = arrangeSelectionItems(targets, action);
      await ports.flush(guard);
      writable();
      await ports.editor.updateLayouts(updates);
      guard();
      await ports.reload();
      guard();
      ports.notice(`${targets.length}개 항목의 배치를 정리했습니다.`);
    });
  }
  setColors(items: { id?: string; relativePath: string }[], color: string) {
    const targets = structuredClone(items);
    return this.run(
      targets.map((item) => item.relativePath),
      async (ports, guard, writable, scope) => {
        await ports.flush(guard);
        writable();
        const [documents, previews] = await Promise.all([
          ports.editor.listDocuments(),
          ports.preview.listPreviews(),
        ]);
        writable();
        const commands = targets.map((target) => {
          const current = [...documents, ...previews].find(
            (item) => item.relativePath === target.relativePath,
          );
          if (
            !current ||
            (!isPreviewPath(target.relativePath) &&
              target.id &&
              'id' in current &&
              current.id !== target.id)
          )
            throw Error('색상을 변경할 항목이 삭제되었거나 교체되었습니다.');
          return {
            channel: 'documents:set-color',
            input: {
              relativePath: target.relativePath,
              ...(!isPreviewPath(target.relativePath)
                ? { objectId: target.id }
                : {}),
              revision: current.revision,
              color,
            },
          };
        });
        if (!commands.length) return;
        await this.batch(ports, scope, commands, guard, writable);
        await ports.reload();
        guard();
        ports.notice(`${targets.length}개 카드의 배경색을 변경했습니다.`);
      },
    );
  }
  dispose() {
    this.disposed = true;
  }
  activate() {
    this.disposed = false;
  }
}
