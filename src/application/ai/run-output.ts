import type { AiProcessEvent } from './ai-executor.ts';

export interface AiRunOutput {
  readonly lastMessage: string;
  readonly failure: string;
  readonly stderr: string;
  consume(event: AiProcessEvent): void;
  flush(): void;
  reset(): void;
}
