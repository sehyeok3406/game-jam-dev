import type {
  AiExecutor,
  PreparedAiRun,
  AiExecutionResult,
} from './ai-executor.ts';
import type { AiRunEvents } from './run-events.ts';
import type { AiRunRecords } from './run-records.ts';
import type { AiPublication } from './run-service.ts';
import type { AiRunOutput } from './run-output.ts';
import type { Snapshot } from '../../contracts/project.ts';
import type { HistoryEntry } from '../../contracts/history.ts';
import type {
  AiRunStatus,
  AiFileLock,
  AiRunEvent,
} from '../../contracts/ai.ts';
import type { ProjectSessionRef } from '../../contracts/project-session.ts';
import type { FailureInfo } from '../../contracts/errors.ts';
import { aiProvider } from '../../core/ai/catalog.ts';
import { CanvasError, failureInfo, errorText } from '../../app-errors.ts';
import { taskHistoryRecord } from '../../ai-task-history.ts';

export interface AiRunWorkflow {
  stages: string[];
  stageIndex: number;
  preparePhase(): Promise<void>;
  inputFiles?(): Promise<Snapshot>;
  embedAssets(provider: PreparedAiRun['providerId']): Promise<void>;
  advance(): Promise<void>;
  validateFinal(
    outputs: (paths: string[]) => void,
    phase: (value: string) => void,
  ): Promise<{ staged: Snapshot; outputs: string[] }>;
  publish(
    staged: Snapshot,
    outputs: string[],
    input: AiPublication,
  ): Promise<void>;
}
export type AiRunContext = {
  sessionRef: ProjectSessionRef | null;
  root: string;
  taskPath: string;
  fileLock: AiFileLock;
  lockBaseline: Snapshot;
  baseline: Snapshot;
  prepared: PreparedAiRun;
  history: Omit<HistoryEntry, 'files'>;
  outputs: string[];
  requiresLease: boolean;
};
export interface AiRunLease {
  valid(): boolean;
  finish(
    status: string,
    changes: Snapshot,
    model: string | null,
    failure?: FailureInfo,
  ): Promise<unknown>;
}
type Ports = {
  executor: AiExecutor;
  workflow: AiRunWorkflow;
  output: AiRunOutput;
  events: AiRunEvents;
  records: AiRunRecords;
  lease?: AiRunLease;
  assertCurrent(): void;
  serial<T>(operation: () => Promise<T>): Promise<T>;
  complete(): Promise<void>;
  error(message: string, error: unknown): void;
  appVersion: string;
  now?: () => number;
};

/** One run owns its state machine. All persistence/lease ports are bound to its starting session. */
export class AiRunCoordinator {
  readonly context: AiRunContext;
  private ports: Ports;
  private controller = new AbortController();
  private execution?: Promise<void>;
  private cancellation?: Promise<void>;
  private cancelled = false;
  private validating = false;
  private finished = false;
  private phaseSequence = 0;
  private acceptingOutput = false;
  constructor(context: AiRunContext, ports: Ports) {
    this.context = {
      ...context,
      prepared: structuredClone(context.prepared),
      history: structuredClone(context.history),
      outputs: [...context.outputs],
    };
    this.ports = ports;
  }
  get sessionRef() {
    return this.context.sessionRef;
  }
  get root() {
    return this.context.root;
  }
  get runId() {
    return this.context.prepared.runId;
  }
  get taskPath() {
    return this.context.taskPath;
  }
  get baseline() {
    return this.context.baseline;
  }
  get fileLock() {
    return this.context.fileLock;
  }
  get providerId() {
    return this.context.prepared.providerId;
  }
  get modelId() {
    return this.context.prepared.modelId;
  }
  get reasoningEffort() {
    return this.context.prepared.reasoningEffort;
  }
  get cancelRequested() {
    return this.cancelled;
  }
  get finalizing() {
    return this.validating;
  }
  private now() {
    return (this.ports.now ?? Date.now)();
  }
  private emit(
    status: AiRunStatus,
    kind: AiRunEvent['kind'],
    message: string,
    failure?: FailureInfo,
  ) {
    this.ports.events.emit(status, kind, message, failure);
  }
  async prepare() {
    if (!this.ports.workflow.stages.length) return;
    await this.preparePhase();
  }
  private async preparePhase() {
    const workflow = this.ports.workflow;
    await workflow.preparePhase();
    this.emit(
      'running',
      'status',
      workflow.stageIndex === 0
        ? 'gamejam! · 1/2 문서 정리 중'
        : 'gamejam! · 2/2 이번에 정리한 문서로 HTML 구현 중',
    );
  }
  cancel(force = false, announce = false) {
    if (this.finished) return Promise.resolve();
    this.cancelled = true;
    if (this.validating && !force) return Promise.resolve();
    if (!this.cancellation) {
      if (announce)
        this.emit('running', 'status', 'AI 프로세스를 중지하고 있습니다.');
      this.controller.abort();
      this.cancellation = this.ports.executor.cancel(this.runId);
    }
    return this.cancellation;
  }
  run() {
    return (this.execution ??= this.execute());
  }
  private async execute() {
    const p = this.ports,
      workflow = p.workflow;
    try {
      this.emit(
        'starting',
        'status',
        `${aiProvider(this.providerId).label}를 시작하고 있습니다.`,
      );
      while (true) {
        let result: AiExecutionResult;
        const phaseSequence = ++this.phaseSequence;
        this.acceptingOutput = true;
        try {
          p.assertCurrent();
          const prepared =
            this.providerId === 'grok-cli'
              ? {
                  ...this.context.prepared,
                  inputFiles: await workflow.inputFiles?.(),
                }
              : this.context.prepared;
          if (this.providerId === 'grok-cli' && !prepared.inputFiles)
            throw Error('Grok 실행 입력 사본을 준비하지 못했습니다.');
          p.assertCurrent();
          result = await p.executor.run(
            prepared,
            this.controller.signal,
            (event) => {
              if (
                !this.finished &&
                this.acceptingOutput &&
                phaseSequence === this.phaseSequence
              )
                p.output.consume(event);
            },
          );
        } catch (error) {
          result = {
            code: null,
            error: error instanceof Error ? error : Error(String(error)),
          };
        }
        this.acceptingOutput = false;
        if (
          result.code === 0 &&
          !result.error &&
          !this.cancelled &&
          this.providerId !== 'codex-cli'
        ) {
          try {
            await workflow.embedAssets(this.providerId);
          } catch (error) {
            result.error =
              error instanceof Error ? error : Error(String(error));
          }
        }
        p.output.flush();
        if (
          workflow.stages.length &&
          workflow.stageIndex === 0 &&
          result.code === 0 &&
          !result.error &&
          !p.output.failure &&
          !this.cancelled
        ) {
          this.validating = true;
          try {
            this.emit(
              'validating',
              'status',
              'gamejam! · 정리 문서를 검증하고 있습니다. 아직 결과는 반영하지 않습니다.',
            );
            await workflow.advance();
            if (this.cancelled) break;
            p.assertCurrent();
            workflow.stageIndex = 1;
            await this.preparePhase();
            if (this.cancelled) break;
            p.assertCurrent();
            p.output.reset();
            this.validating = false;
            continue;
          } catch (error) {
            await this.finalize(
              null,
              error instanceof Error ? error : Error(String(error)),
            );
            return;
          }
        }
        await this.finalize(result.code, result.error);
        return;
      }
      await this.finalize(null);
    } finally {
      this.finished = true;
      await p.complete();
    }
  }
  private async finalize(code: number | null, processError?: Error) {
    const p = this.ports,
      context = this.context,
      workflow = p.workflow;
    this.validating = true;
    let status: AiRunStatus = this.cancelled
      ? 'cancelled'
      : code === 0 && !processError && !p.output.failure
        ? 'completed'
        : 'failed';
    let message =
      p.output.failure ||
      processError?.message ||
      p.output.stderr ||
      (status === 'failed'
        ? `${aiProvider(this.providerId).label}가 종료 코드 ${code ?? 'unknown'}로 끝났습니다.`
        : '');
    let phase = workflow.stages.length
      ? `${workflow.stageIndex === 0 ? 'organize' : 'implement'}-execute`
      : 'execute';
    let tracedError: unknown =
      status === 'failed'
        ? processError instanceof CanvasError
          ? processError
          : new CanvasError('GC-AI-002', message, {
              exitCode: code,
              processError: processError?.name,
            })
        : null;
    if (status === 'completed') {
      try {
        this.emit(
          'validating',
          'status',
          '결과 파일과 HTML 초기 실행을 확인하고 있습니다.',
        );
        const { staged } = await workflow.validateFinal(
          (outputs) => {
            context.outputs = outputs;
            if (context.history.aiTask)
              context.history.aiTask = { ...context.history.aiTask, outputs };
          },
          (value) => {
            phase = value;
          },
        );
        if (this.cancelled) throw Error('결과 확인을 중지했습니다.');
        await p.serial(async () => {
          p.assertCurrent();
          await workflow.publish(staged, context.outputs, {
            history: context.history,
            lockBaseline: context.lockBaseline,
            fileLock: context.fileLock,
            cancelled: () => {
              p.assertCurrent();
              return this.cancelled;
            },
            requiresLease: context.requiresLease,
            shared: p.lease?.valid()
              ? {
                  finish: (changes) =>
                    p.lease!.finish('completed', changes, this.modelId),
                }
              : undefined,
            phase: (value) => {
              phase = value;
            },
          });
        });
      } catch (error) {
        tracedError = error;
        status = this.cancelled ? 'cancelled' : 'failed';
        message = error instanceof Error ? error.message : String(error);
      }
    }
    const failure =
      status === 'failed'
        ? failureInfo(
            tracedError,
            phase === 'publish' ? 'GC-IO-001' : 'GC-AI-001',
          )
        : undefined;
    if (failure) {
      failure.diagnosticPath = `.history/${this.runId}/diagnostic.json`;
      message = errorText(failure);
    }
    await p.records
      .diagnostic({
        schemaVersion: 1,
        appVersion: p.appVersion,
        runId: this.runId,
        taskPath: this.taskPath,
        providerId: this.providerId,
        modelId: this.modelId,
        reasoningEffort: this.reasoningEffort ?? null,
        workflowStage: workflow.stages.length
          ? workflow.stageIndex === 0
            ? 'organize'
            : 'implement'
          : null,
        status,
        phase,
        exitCode: code,
        startedAt: new Date(context.history.createdAt).toISOString(),
        finishedAt: new Date(this.now()).toISOString(),
        failure: failure ?? null,
        outputs: context.outputs,
        events: p.events.snapshot(),
      })
      .catch((error) => {
        if (failure) {
          delete failure.diagnosticPath;
          failure.details.diagnosticWriteError = String(error);
        }
        p.error('Failed to write diagnostic', error);
      });
    if (status !== 'completed') {
      if (p.lease?.valid())
        await p.lease
          .finish(status, {}, this.modelId, failure)
          .catch(() => undefined);
      await p.records
        .history({
          ...context.history,
          status,
          error: message,
          failure,
          finishedAt: this.now(),
        })
        .catch((error) => p.error('Failed to record run', error));
    }
    await p.records
      .task(status, {
        ai_finished_at: new Date(this.now()).toISOString(),
        ai_error: message || null,
        ai_error_code: failure?.code ?? null,
        ai_diagnostic_path: failure?.diagnosticPath ?? null,
        ai_result: p.output.lastMessage || null,
      })
      .catch((error) => p.error('Failed to update AI task status', error));
    this.emit(
      status,
      status === 'completed'
        ? 'result'
        : status === 'failed'
          ? 'error'
          : 'status',
      status === 'completed'
        ? p.output.lastMessage || 'AI 작업이 완료되었습니다.'
        : status === 'cancelled'
          ? 'AI 작업을 취소했습니다.'
          : message,
      failure,
    );
  }
}

/** Preparation never acquires another project's records or a later lease on failure. */
export async function recordAiPreparationFailure(input: {
  event: AiRunEvent | null;
  events?: AiRunEvents;
  records?: AiRunRecords;
  error: unknown;
  cancelled: boolean;
  lease?: AiRunLease;
  now?: () => number;
}) {
  const { event, events, records } = input;
  const now = input.now ?? Date.now;
  const failure = input.cancelled
    ? undefined
    : failureInfo(input.error, 'GC-AI-001');
  const status = input.cancelled ? 'cancelled' : 'failed';
  const message = failure ? errorText(failure) : 'AI 작업 준비를 중지했습니다.';
  if (event && events && records) {
    if (failure) {
      failure.diagnosticPath = `.history/${event.runId}/diagnostic.json`;
      await records
        .diagnostic({
          schemaVersion: 1,
          runId: event.runId,
          taskPath: event.taskPath,
          phase: 'prepare',
          status,
          failure,
          events: events.snapshot(),
        })
        .catch(() => {
          delete failure.diagnosticPath;
        });
    }
    await records
      .task(status, {
        ai_error: message,
        ai_error_code: failure?.code,
        ai_diagnostic_path: failure?.diagnosticPath,
      })
      .catch(() => undefined);
    await records
      .history({
        id: event.runId,
        label: 'AI 작업 준비',
        kind: 'ai',
        status,
        createdAt: event.timestamp,
        finishedAt: now(),
        taskPath: event.taskPath,
        error: message,
        providerId: event.providerId,
        modelId: event.modelId,
        reasoningEffort: event.reasoningEffort,
        failure,
        aiTask: taskHistoryRecord(await records.specification()),
      })
      .catch(() => undefined);
    events.emit(status, 'error', message, failure);
  }
  if (input.lease?.valid())
    await input.lease.finish(status, {}, null, failure).catch(() => undefined);
}
