import type { Project, Member, Lock } from '../project-state.ts';
import type { CollaborationEnvelope } from '../../contracts/collaboration.ts';
import { serverCapabilities } from '../capabilities.ts';
import { queueTaskView } from '../../ai-task-queue.ts';
import { PROJECT_LAYOUT_PATH } from '../../contracts/project-layout.ts';
export const projectEnvelope = (
  project: Project,
  member: Member,
  ports: {
    version: string;
    now: () => number;
    online: (id: string, memberId: string) => number | undefined;
    locks: (id: string) => ReadonlyMap<string, Lock>;
  },
): CollaborationEnvelope => ({
  files: project.files,
  properties: project.propertyVersions ?? {},
  revisions: project.revisions,
  authorship: project.authorship,
  state: {
    active: true,
    handover: project.handover
      ? {
          id: project.handover.id,
          from: project.handover.from,
          to: project.handover.to,
          accepted: project.handover.accepted,
        }
      : undefined,
    ...serverCapabilities(),
    fileLayoutVersion: project.files[PROJECT_LAYOUT_PATH] ? 2 : 1,
    connected: true,

    lifecycleVersion: project.lifecycle?.version ?? 0,

    serverVersion: ports.version,
    offlineSync: true,
    projectRename: true,

    editorAi: false,
    requestApprovalVersion: 1,
    requestDeletionVersion: 1,
    requestDocumentVersion: 1,
    requestsVersion: project.requestsVersion ?? 0,
    pendingRequests: Object.values(project.approvals ?? {}).filter(
      (item) => item.status === 'pending',
    ).length,
    multiProviderAi: true,
    aiReasoningVersion: 1,
    projectId: project.id,
    projectName: project.name,
    projectCreatedAt: project.createdAt,
    projectModifiedAt: project.modifiedAt,
    memberId: member.id,
    role: member.role,
    revision: project.revision,
    members: project.members
      .filter((member) => !member.removed)
      .map((member) => ({
        id: member.id,
        nickname: member.nickname,
        role: member.role,
        owner: member.owner,
        online:
          (ports.online(project.id, member.id) ?? 0) > ports.now() - 12000,
      })),
    locks: [...ports.locks(project.id)].map(([relativePath, lock]) => ({
      relativePath,
      memberId: lock.memberId,
      nickname:
        project.members.find((member) => member.id === lock.memberId)
          ?.nickname ?? '참여자',
    })),
    aiRun: project.job?.event ?? project.lastRun,
    aiQueueVersion: 1,
    aiQueue: (project.aiQueue ?? []).map(queueTaskView),
    inviteExpiresAt:
      member.role === 'admin' ? project.inviteExpiresAt : undefined,
  },
});
