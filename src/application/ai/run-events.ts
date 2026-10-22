import type {
  AiRunEvent,
  AiRunStatus,
  AiFileLock,
  AiProviderId,
  AiReasoningEffort,
} from '../../contracts/ai.ts';
import type { ProjectSessionRef } from '../../contracts/project-session.ts';
import type { FailureInfo } from '../../contracts/errors.ts';
import { redactDiagnostic } from '../../app-errors.ts';

export type AiEventIdentity = {
  runId: string;
  taskPath: string;
  projectSession?: ProjectSessionRef;
  actorId?: string;
  providerId: AiProviderId;
  modelId: string | null;
  reasoningEffort: AiReasoningEffort | null;
  fileLock?: AiFileLock;
};
type EventPorts = {
  publish(event: AiRunEvent): void;
  persist(event: AiRunEvent): Promise<unknown>;
  progress?(event: AiRunEvent): Promise<unknown>;
  error(error: unknown): void;
  now?: () => number;
};

/** Immutable run identity; only the bounded timeline and current lock can change. */
export class AiRunEvents {
  private identity: AiEventIdentity;
  private ports: EventPorts;
  private timeline: AiRunEvent[] = [];
  private lastProgressStatus = '';
  constructor(identity: AiEventIdentity, ports: EventPorts) {
    this.identity = structuredClone(identity);
    this.ports = ports;
  }
  latest() {
    return structuredClone(this.timeline.at(-1) ?? null);
  }
  setFileLock(lock: AiFileLock) {
    this.identity.fileLock = structuredClone(lock);
  }
  snapshot() {
    return structuredClone(this.timeline);
  }
  emit(
    status: AiRunStatus,
    kind: AiRunEvent['kind'],
    message: string,
    failure?: FailureInfo,
  ) {
    const event: AiRunEvent = {
      ...structuredClone(this.identity),
      status,
      kind,
      message: redactDiagnostic(message).slice(0, 8000),
      timestamp: (this.ports.now ?? Date.now)(),
      ...(failure ? { failure } : {}),
    };
    this.timeline.push(structuredClone(event));
    this.timeline = this.timeline.slice(-200);
    void this.ports.persist(event).catch(this.ports.error);
    this.ports.publish(event);
    if (
      this.ports.progress &&
      ['starting', 'running', 'validating'].includes(status) &&
      this.lastProgressStatus !== status
    ) {
      this.lastProgressStatus = status;
      void this.ports.progress(event).catch(() => undefined);
    }
    return event;
  }
}
