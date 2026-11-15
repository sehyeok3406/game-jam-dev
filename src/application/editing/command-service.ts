import type { CommandEnvironment } from '../../core/editing/environment.ts';
import type {
  CanvasFileScope,
  LocalProjectRepository,
} from '../ports/local-project-repository.ts';
import {
  reduceCollaboration,
  reduceLocalCollaboration,
} from '../../collaboration-model.ts';
import {
  isCommandName,
  type CommandName,
  type CommandInput,
  type CommandOutput,
} from '../../contracts/commands.ts';
import type { Snapshot } from '../../contracts/project.ts';

/** The existing reducer owns both external validation and atomic calculation. */
export function applyExternalCommand(
  files: Snapshot,
  channel: unknown,
  input: unknown,
  environment?: CommandEnvironment,
) {
  if (!isCommandName(channel))
    throw new Error('허용되지 않은 공동 작업입니다.');
  return reduceCollaboration(files, channel, input, environment);
}

export function applyCommand<K extends CommandName>(
  files: Snapshot,
  channel: K,
  input: CommandInput<K>,
  environment?: CommandEnvironment,
): { files: Snapshot; result: CommandOutput<K> } {
  return reduceLocalCollaboration(files, channel, input, environment) as {
    files: Snapshot;
    result: CommandOutput<K>;
  };
}

export type CommandPlan<T = unknown> = {
  before: Snapshot;
  files: Snapshot;
  changes: Record<string, string | null>;
  result: T;
};

export function snapshotChanges(
  before: Snapshot,
  after: Snapshot,
): Record<string, string | null> {
  return Object.fromEntries(
    Object.keys({ ...before, ...after })
      .filter((path) => before[path] !== after[path])
      .map((path) => [path, after[path] ?? null]),
  );
}

export interface CommandPublisher {
  publish(channel: CommandName, plan: CommandPlan): Promise<void>;
}

/** Identify canvas files used by local geometry history and isolated drawing commands. */
export function canvasMutationScope(
  channel: string,
  input: unknown,
): CanvasFileScope | undefined {
  if (channel === 'drawings:apply') return 'drawings';
  if (
    channel === 'game-ui:apply' &&
    (input as { action?: string } | null)?.action === 'frame'
  )
    return 'game-ui';
  if (
    [
      'layouts:update',
      'sections:update-layout',
      'sections:move-document',
    ].includes(channel)
  )
    return 'layout';
  if (channel === 'canvas:batch') {
    const commands = (input as { commands?: { channel?: string }[] } | null)
      ?.commands;
    if (
      Array.isArray(commands) &&
      commands.every(
        (part) =>
          part?.channel === 'layouts:update' ||
          part?.channel === 'drawings:apply',
      )
    )
      return 'layout';
  }
}

/** Calculate once, then publish only changed files through the existing atomic repository. */
export class LocalCommandService {
  private repository: LocalProjectRepository;
  private environment?: CommandEnvironment;
  private publisher?: CommandPublisher;
  constructor(
    repository: LocalProjectRepository,
    environment?: CommandEnvironment,
    publisher?: CommandPublisher,
  ) {
    this.repository = repository;
    this.environment = environment;
    this.publisher = publisher;
  }

  async plan<K extends CommandName>(
    channel: K,
    input: CommandInput<K>,
  ): Promise<CommandPlan<CommandOutput<K>>> {
    const scope = canvasMutationScope(channel, input);
    // Layout batches still validate section membership and linked preview/image
    // records against the complete project. Their history captures can be narrow.
    const before = await (scope &&
    scope !== 'layout' &&
    this.repository.captureCanvas
      ? this.repository.captureCanvas(scope)
      : this.repository.capture());
    const reduced = applyCommand(before, channel, input, this.environment);
    return {
      before,
      ...reduced,
      changes: snapshotChanges(before, reduced.files),
    };
  }

  async execute<K extends CommandName>(
    channel: K,
    input: CommandInput<K>,
  ): Promise<CommandOutput<K>> {
    const plan = await this.plan(channel, input);
    if (this.publisher) await this.publisher.publish(channel, plan);
    else await this.repository.apply(plan.before, plan.changes);
    return plan.result;
  }
}
