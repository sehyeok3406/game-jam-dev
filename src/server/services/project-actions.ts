import type { Project, Member } from '../project-state.ts';
import type { CollaborationCommand } from '../../contracts/collaboration.ts';
import { ApiError } from './errors.ts';
type Execute = {
  execute: (
    p: Project,
    m: Member,
    action: string,
    input: Record<string, unknown>,
  ) => unknown;
};
type Ports = {
  modes?: Execute;
  stateService: Execute;
  approvals: Execute;
  history: Execute;
  members: {
    leave: (p: Project, m: Member) => unknown;
    rotateInvite: (p: Project, m: Member) => unknown;
    setRole: (p: Project, m: Member, input: Record<string, unknown>) => unknown;
  };
  offline: {
    execute: (p: Project, m: Member, input: Record<string, unknown>) => unknown;
  };
  commands: {
    execute: (p: Project, m: Member, input: CollaborationCommand) => unknown;
  };
  projectService: {
    upgradeLayout?: (
      p: Project,
      m: Member,
      input: Record<string, unknown>,
    ) => unknown;
    rename: (p: Project, m: Member, input: Record<string, unknown>) => unknown;
  };
  ai: {
    start: (
      p: Project,
      m: Member,
      action: 'ai-start' | 'requests-start' | 'ai-claim',
      input: Record<string, unknown>,
    ) => unknown;
  };
  aiRun: {
    cancelQueued: (
      p: Project,
      m: Member,
      input: Record<string, unknown>,
    ) => unknown;
    update: (
      p: Project,
      m: Member,
      action: string,
      input: Record<string, unknown>,
    ) => unknown;
  };
};
export function createProjectActions(ports: Ports) {
  return (
    project: Project,
    member: Member,
    action: string,
    input: Record<string, unknown>,
  ) => {
    if (['state', 'lock', 'unlock'].includes(action))
      return ports.stateService.execute(project, member, action, input);
    if (
      action === 'mode-snapshot' ||
      action === 'detach' ||
      action.startsWith('handover-')
    )
      return ports.modes?.execute(project, member, action, input);
    if (action === 'leave') return ports.members.leave(project, member);
    if (action.startsWith('requests-') && action !== 'requests-start')
      return ports.approvals.execute(project, member, action, input);
    if (action === 'offline-sync')
      return ports.offline.execute(project, member, input);
    if (action === 'command')
      return ports.commands.execute(
        project,
        member,
        input as unknown as CollaborationCommand,
      );
    if (action === 'invite') return ports.members.rotateInvite(project, member);
    if (action === 'rename')
      return ports.projectService.rename(project, member, input);
    if (action === 'layout-upgrade')
      return ports.projectService.upgradeLayout?.(project, member, input);
    if (action === 'role') return ports.members.setRole(project, member, input);
    if (
      ['history', 'history-read', 'history-change', 'restore'].includes(action)
    )
      return ports.history.execute(project, member, action, input);
    if (action === 'ai-queue-cancel')
      return ports.aiRun.cancelQueued(project, member, input);
    if (action.startsWith('ai-') || action === 'requests-start') {
      if (member.role === 'viewer')
        throw new ApiError('뷰어는 AI를 실행하거나 중지할 수 없습니다.', 403);
      if (
        action === 'ai-start' ||
        action === 'requests-start' ||
        action === 'ai-claim'
      )
        return ports.ai.start(project, member, action, input);
      return ports.aiRun.update(project, member, action, input);
    }
    throw new ApiError('지원하지 않는 작업입니다.', 404);
  };
}
