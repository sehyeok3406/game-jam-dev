import type { Snapshot } from '../../contracts/project.ts';
import type { AiProviderId, AiReasoningEffort } from '../../contracts/ai.ts';

/** A single isolated run directory, never the user's working project. */
export interface AiStageWorkspace {
  readonly directory: string;
  initialize(files: Snapshot): Promise<void>;
  capture(): Promise<Snapshot>;
  write(relative: string, content: string): Promise<void>;
  configure(
    provider: AiProviderId,
    model: string | null,
    effort: AiReasoningEffort | null,
  ): Promise<void>;
}
