import type { CollaborationRole } from './collaboration.ts';
import type { ServiceMode, WorkspaceEntitlements } from './capabilities.ts';

/** Service IDs are separate from the existing project member IDs. */
export type ProjectAccess = {
  projectId: string;
  userId: string;
  role: CollaborationRole;
  status: 'active' | 'revoked';
};

export type VerifiedActor =
  | { kind: 'local' }
  | {
      kind: 'project-member';
      projectId: string;
      memberId: string;
      role: CollaborationRole;
    }
  | { kind: 'service-user'; userId: string };

/** Input to the future server policy, never accepted directly from a request body. */
export type AccessPolicyInput = {
  actor: VerifiedActor;
  mode: ServiceMode;
  project: { id: string; workspaceId?: string };
  membership?: {
    workspaceId: string;
    userId: string;
    role: 'owner' | 'admin' | 'member';
    status: 'active' | 'revoked';
  };
  access?: ProjectAccess;
  entitlements?: WorkspaceEntitlements;
  action:
    | 'read'
    | 'export'
    | 'write'
    | 'manage-members'
    | 'approve-ai'
    | 'claim-ai'
    | 'publish-ai';
};

export type AccessDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | 'authentication-required'
        | 'membership-inactive'
        | 'project-access-denied'
        | 'collaboration-entitlement-required'
        | 'ai-claim-invalid';
    };
