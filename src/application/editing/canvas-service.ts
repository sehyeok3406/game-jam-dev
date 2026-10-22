import type { LocalProjectRepository } from '../ports/local-project-repository.ts';
import { LocalCommandService, snapshotChanges } from './command-service.ts';
import { readCanvasSheets, CANVAS_SHEETS_PATH } from '../../canvas-sheets.ts';
import { snapshotDrawings } from '../../drawing-model.ts';
import { snapshotGameUi, applyGameUi } from '../../game-ui-model.ts';
import type { DrawingCommand } from '../../contracts/drawing-types.ts';
import type { GameUiCommand } from '../../contracts/game-ui-types.ts';
import type {
  CommandName,
  CommandInput,
  CommandOutput,
} from '../../contracts/commands.ts';

/** Canvas data and acknowledged request IDs are independent of Electron and IPC. */
export class LocalCanvasService {
  private drawingRequests = new Set<string>();
  private gameUiRequests = new Set<string>();
  private repository: () => LocalProjectRepository;
  private signature: (value: unknown) => string;
  constructor(
    repository: () => LocalProjectRepository,
    signature: (value: unknown) => string,
  ) {
    this.repository = repository;
    this.signature = signature;
  }

  async canvases() {
    const files = await this.repository().capture();
    return {
      ...readCanvasSheets(files[CANVAS_SHEETS_PATH]),
      raw: files[CANVAS_SHEETS_PATH] ?? null,
    };
  }
  async drawings() {
    return snapshotDrawings(await this.repository().capture());
  }
  async drawingDelta(known: Record<string, string> = {}) {
    return drawingChanges(
      await this.repository().capture(),
      known,
      this.signature,
    );
  }
  async gameUi() {
    return snapshotGameUi(await this.repository().capture());
  }
  execute<K extends CommandName>(
    channel: K,
    input: CommandInput<K>,
  ): Promise<CommandOutput<K>> {
    return new LocalCommandService(this.repository()).execute(channel, input);
  }
  async applyDrawing(input: DrawingCommand) {
    const repository = this.repository();
    const key = `${input.scope}:${input.requestId}`;
    if (input.requestId && this.drawingRequests.has(key))
      return snapshotDrawings(await repository.capture());
    const plan = await new LocalCommandService(repository).plan(
      'drawings:apply',
      input,
    );
    await repository.apply(plan.before, plan.changes);
    this.acknowledge(this.drawingRequests, key, input.requestId);
    return snapshotDrawings(plan.files);
  }
  async applyGameUi(input: GameUiCommand) {
    const repository = this.repository();
    const key = `${input.scope}:${input.requestId}`;
    if (input.requestId && this.gameUiRequests.has(key))
      return snapshotGameUi(await repository.capture());
    // Preserve the existing local game's model validation; server snapshot quotas are not a desktop entitlement.
    const before = await repository.capture();
    const after = applyGameUi(before, input);
    await repository.apply(before, snapshotChanges(before, after));
    this.acknowledge(this.gameUiRequests, key, input.requestId);
    return snapshotGameUi(after);
  }
  private acknowledge(requests: Set<string>, key: string, id?: string) {
    if (!id) return;
    requests.add(key);
    if (requests.size > 1000) requests.delete(requests.values().next().value!);
  }
}

export function drawingChanges(
  files: import('../../contracts/project.ts').Snapshot,
  known: Record<string, string>,
  signature: (value: unknown) => string,
) {
  const objects = snapshotDrawings(files);
  const signatures = Object.fromEntries(
    objects.map((object) => [object.id, signature(object)]),
  );
  return {
    changed: objects.filter(
      (object) => known[object.id] !== signatures[object.id],
    ),
    removed: Object.keys(known).filter((id) => !signatures[id]),
    signatures,
  };
}
