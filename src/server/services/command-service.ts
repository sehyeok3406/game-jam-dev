import { ServerLimits } from '../../contracts/server-limits.ts';
import type { CollaborationCommand } from '../../contracts/collaboration.ts';
import type { Snapshot } from '../../contracts/project.ts';
import { CANVAS_SHEETS_PATH } from '../../canvas-sheets.ts';
import { collaborationPath, commandLabels } from '../../collaboration-model.ts';
import { changedGroups } from '../../sync-properties.ts';
import { ApiError } from './errors.ts';

type CommandProject = {
  id: string;
  files: Snapshot;
  propertySync?: boolean;
  sequences?: Record<string, number>;
  job: unknown | null;
  history: { entry: { id: string; files: unknown[] } }[];
  applied: { id: string; memberId: string; result: unknown }[];
};
type Actor = { id: string };
type CommandPorts<P, M, E> = {
  admin: (member: M) => void;
  editable: (project: P, member: M) => void;
  locks: (
    projectId: string,
  ) => ReadonlyMap<string, { memberId: string; token: string }>;
  reduce: (
    files: Snapshot,
    channel: string,
    input: unknown,
  ) => { files: Snapshot; result: unknown };
  assertAiMutation: (
    project: P,
    after: Snapshot,
    command: CollaborationCommand,
  ) => void;
  assertBases: (
    project: P,
    before: Snapshot,
    after: Snapshot,
    revisions: Record<string, number>,
    member: M,
    command: CollaborationCommand,
  ) => void;
  clone: (project: P) => P;
  recordChanges: (
    project: P,
    member: M,
    files: Snapshot,
    label: string,
  ) => void;
  persist: (project: P) => Promise<void>;
  envelope: (project: P, member: M) => E;
};

/** Runs inside the caller's project queue, with its current authenticated actor.
 * Common ingress/lifecycle/capability gates remain at that queued entry point.
 * Persistence publishes the candidate only after its durable commit succeeds.
 */
export function createCommandService<
  P extends CommandProject,
  M extends Actor,
  E extends object,
>(ports: CommandPorts<P, M, E>) {
  async function execute(project: P, member: M, command: CollaborationCommand) {
    if (command.channel === 'tasks:create') ports.admin(member);
    if (typeof command.id !== 'string' || !/^[a-f0-9-]{36}$/.test(command.id))
      throw new ApiError('작업 ID가 올바르지 않습니다.', 400);
    const applied = project.applied.find(
      (operation) => operation.id === command.id,
    );
    if (applied) {
      if (applied.memberId !== member.id)
        throw new ApiError('작업 ID가 충돌했습니다.');
      const stored = applied.result as {
        value?: unknown;
        historyId?: string;
      } | null;
      return {
        ...ports.envelope(project, member),
        result: stored && 'historyId' in stored ? stored.value : applied.result,
        historyId: stored?.historyId,
      };
    }
    ports.editable(project, member);
    if (command.channel === 'documents:save') {
      const relative = collaborationPath(
        (
          command.input as {
            relativePath: string;
          }
        )?.relativePath,
      );
      const lock = ports.locks(project.id).get(relative);
      if (
        !lock ||
        lock.memberId !== member.id ||
        lock.token !== command.lockToken
      )
        throw new ApiError(
          '문서 편집 잠금이 만료되었습니다. 초안을 복사하고 다시 편집해주세요.',
        );
    }
    if (project.files[CANVAS_SHEETS_PATH] && command.canvasSheetsVersion !== 1)
      throw new ApiError(
        '캔버스가 있는 프로젝트를 편집하려면 앱을 v0.11.0 이상으로 업데이트해주세요.',
      );
    if (
      command.propertySyncVersion === 1 &&
      (!command.sessionId ||
        !/^[a-f0-9-]{36}$/.test(command.sessionId) ||
        !Number.isSafeInteger(command.sequence) ||
        command.sequence! < 1)
    )
      throw new ApiError('수정 순번이 올바르지 않습니다.', 400);
    // Creation/no-op commands may have no stable changed path. Keep the session
    // high-water mark as well as property marks so an evicted receipt cannot
    // turn an old request into a new creation. Exact retained receipts replay above.
    const requestSequenceKey =
      command.propertySyncVersion === 1
        ? `${member.id}:${command.sessionId}:request`
        : undefined;
    if (
      requestSequenceKey &&
      (project.sequences?.[requestSequenceKey] ?? 0) >= command.sequence!
    )
      throw new ApiError('오래된 수정 요청입니다. 최신 변경을 유지합니다.');
    const reduced = ports.reduce(project.files, command.channel, command.input);
    if (
      project.job &&
      command.channel === 'tasks:create' &&
      (
        command.input as {
          queueVersion?: number;
        }
      )?.queueVersion !== 1
    )
      throw new ApiError('이미 AI 작업이 진행 중입니다.');
    ports.assertAiMutation(project, reduced.files, command);
    ports.assertBases(
      project,
      project.files,
      reduced.files,
      command.revisions,
      member,
      command,
    );
    const sequenceKeys =
      command.propertySyncVersion === 1
        ? Object.keys(reduced.files)
            .filter(
              (relative) => project.files[relative] !== reduced.files[relative],
            )
            .flatMap((relative) =>
              changedGroups(
                relative,
                project.files[relative],
                reduced.files[relative],
              ).map(
                (group) =>
                  `${member.id}:${command.sessionId}:${relative}:${group}`,
              ),
            )
        : [];
    for (const key of sequenceKeys)
      if ((project.sequences?.[key] ?? 0) >= command.sequence!)
        throw new ApiError('오래된 수정 요청입니다. 최신 변경을 유지합니다.');
    const next = ports.clone(project);
    if (command.propertySyncVersion === 1) {
      next.propertySync = true;
      next.sequences = { ...next.sequences };
      next.sequences[requestSequenceKey!] = command.sequence!;
      for (const key of sequenceKeys) next.sequences[key] = command.sequence!;
    }
    ports.recordChanges(
      next,
      member,
      reduced.files,
      commandLabels[command.channel],
    );
    next.applied.push({
      id: command.id,
      memberId: member.id,
      result: {
        value: reduced.result,
        historyId: next.history.at(-1)!.entry.files.length
          ? next.history.at(-1)!.entry.id
          : null,
      },
    });
    next.applied = next.applied.slice(-ServerLimits.receipts);
    await ports.persist(next);
    return {
      ...ports.envelope(next, member),
      result: reduced.result,
      historyId: next.history.at(-1)!.entry.files.length
        ? next.history.at(-1)!.entry.id
        : null,
    };
  }
  return { execute };
}
