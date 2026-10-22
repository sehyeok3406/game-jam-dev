/** Stable public entry; composition lives in server/bootstrap. */
export { createCollaborationServer, activeEvent } from './server/bootstrap.ts';
export type {
  CollaborationCommand,
  CollaborationEnvelope,
} from './contracts/collaboration.ts';
