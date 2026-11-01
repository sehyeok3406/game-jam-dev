import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { AiProviderId } from '../../contracts/ai.ts';
import type {
  AiExecutor,
  PreparedAiRun,
  AiProcessEvent,
  AiExecutionResult,
} from '../../application/ai/ai-executor.ts';
import { aiArguments } from '../../adapters/node/ai/providers.ts';
import { otherCliStatus } from '../../adapters/node/ai/discovery.ts';
import { inspectCodex } from '../../adapters/node/ai/inspection.ts';
import { collectProcess, terminateProcessTree } from './process-runner.ts';
import { prepareGrokProcess } from '../../adapters/node/ai/grok.ts';

/** Owns child processes, UTF-8 decoding and cancellation; the application owns publication. */
export class NodeAiExecutor implements AiExecutor {
  private provider: AiProviderId;
  private processes = new Map<
    string,
    { child: ChildProcessWithoutNullStreams; cancelling?: Promise<void> }
  >();
  constructor(provider: AiProviderId) {
    this.provider = provider;
  }
  async inspect() {
    return this.provider === 'codex-cli'
      ? { ...(await inspectCodex(collectProcess)), providerId: this.provider }
      : otherCliStatus(this.provider, collectProcess);
  }
  async run(
    input: PreparedAiRun,
    signal: AbortSignal,
    emit: (event: AiProcessEvent) => void,
  ): Promise<AiExecutionResult> {
    if (input.providerId !== this.provider)
      throw Error('AI 실행 제공자가 일치하지 않습니다.');
    if (this.processes.has(input.runId))
      throw Error('이미 실행 중인 AI 작업입니다.');
    if (signal.aborted)
      return { code: null, error: Error('AI 실행을 중지했습니다.') };
    const args = aiArguments(
      this.provider,
      input.modelId,
      input.stage,
      input.reasoningEffort,
    );
    const prepared =
      this.provider === 'grok-cli'
        ? await prepareGrokProcess(
            input.executable,
            collectProcess,
            input.stage,
            input.prompt,
            input.inputFiles,
          )
        : null;
    if (signal.aborted) {
      await prepared?.cleanup();
      return { code: null, error: Error('AI 실행을 중지했습니다.') };
    }
    if (this.processes.has(input.runId)) {
      await prepared?.cleanup();
      throw Error('이미 실행 중인 AI 작업이 있습니다.');
    }
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(
        input.executable.executable,
        [
          ...input.executable.prefix,
          ...(prepared ? ['--prompt-file', prepared.promptFile] : []),
          ...args,
        ],
        {
          cwd: input.stage,
          windowsHide: true,
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
          env:
            prepared?.env ??
            (this.provider === 'claude-cli' && input.reasoningEffort
              ? {
                  ...process.env,
                  CLAUDE_CODE_EFFORT_LEVEL: input.reasoningEffort,
                }
              : process.env),
        },
      );
    } catch (error) {
      await prepared?.cleanup();
      throw error;
    }
    const active = { child };
    this.processes.set(input.runId, active);
    return new Promise((resolve) => {
      let settled = false;
      const stdout = new StringDecoder('utf8'),
        stderr = new StringDecoder('utf8');
      const publish = (stream: 'stdout' | 'stderr', text: string) => {
        if (text) emit({ stream, text });
      };
      const finish = (code: number | null, error?: Error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        publish('stdout', stdout.end());
        publish('stderr', stderr.end());
        if (this.processes.get(input.runId) === active)
          this.processes.delete(input.runId);
        if (prepared)
          void prepared.cleanup().then(
            () => resolve({ code, error }),
            () =>
              resolve({
                code,
                error:
                  error ?? Error('Grok 임시 실행 파일 정리에 실패했습니다.'),
              }),
          );
        else resolve({ code, error });
      };
      const abort = () => {
        void this.cancel(input.runId).catch((error) => finish(null, error));
      };
      child.stdout.on(
        'data',
        (chunk: Buffer) => !settled && publish('stdout', stdout.write(chunk)),
      );
      child.stderr.on(
        'data',
        (chunk: Buffer) => !settled && publish('stderr', stderr.write(chunk)),
      );
      child.once('error', (error) => finish(null, error));
      child.stdin.on('error', (error) => finish(null, error));
      child.once('close', (code) => finish(code));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      else child.stdin.end(prepared ? undefined : input.prompt, 'utf8');
    });
  }
  cancel(runId: string): Promise<void> {
    const active = this.processes.get(runId);
    if (!active) return Promise.resolve();
    return (active.cancelling ??= terminateProcessTree(active.child));
  }
}
