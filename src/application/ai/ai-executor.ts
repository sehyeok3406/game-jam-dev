import type {
  AiProviderId,
  AiReasoningEffort,
  CodexConnectionStatus,
} from '../../contracts/ai.ts';
import type { Snapshot } from '../../contracts/project.ts';

/** Private application input: executable/stage paths never enter a collaboration envelope. */
export type PreparedAiRun = {
  runId: string;
  taskId: string;
  stage: string;
  providerId: AiProviderId;
  modelId: string | null;
  reasoningEffort?: AiReasoningEffort | null;
  executable: { executable: string; prefix: string[] };
  prompt: string;
  inputFiles?: Snapshot;
};
export type AiProcessEvent = { stream: 'stdout' | 'stderr'; text: string };
export type AiExecutionResult = { code: number | null; error?: Error };
export interface AiExecutor {
  inspect(): Promise<CodexConnectionStatus>;
  run(
    input: PreparedAiRun,
    signal: AbortSignal,
    emit: (event: AiProcessEvent) => void,
  ): Promise<AiExecutionResult>;
  cancel(runId: string): Promise<void>;
}
