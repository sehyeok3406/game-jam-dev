import type { Snapshot } from '../../contracts/project.ts';
import { readProjectLayout } from '../../core/projects/project-layout.ts';
import type { HistoryEntry } from '../../contracts/history.ts';
import type { AiProviderId } from '../../contracts/ai.ts';
import type { AiFileLock } from '../../contracts/ai.ts';
import type { LocalProjectRepository } from '../ports/local-project-repository.ts';
import type { AiStageWorkspace } from './stage-workspace.ts';
import matter from '../../markdown.ts';
import { CanvasError } from '../../app-errors.ts';
import { assertCanvas, canvasId } from '../../canvas-sheets.ts';
import { expectedArtifacts, validateArtifacts } from '../../ai-artifacts.ts';
import { resolveTaskArtifacts } from '../../document-bundle.ts';
import {
  assertStageInputs,
  newOutputsAlreadyExist,
  workflowStages,
  gameBuildTask,
} from '../../task-plan.ts';
import { validateHtmlAnalysis } from '../../html-source.ts';
import { isPreviewPath } from '../../preview-output.ts';
import { embedSelectedAssets } from '../../ai-asset-links.ts';
import {
  changedAiFile,
  taskFileLock,
  aiLockedSnapshot,
} from '../../ai-file-lock.ts';
import { layoutNewDocuments } from '../../new-document-layout.ts';
import { initializeWorkflows } from '../../document-workflow.ts';
import {
  validateTaskDesignContext,
  taskDesignContextRules,
} from '../../core/ai/task-context.ts';
import type { GameBuildExecutionPort } from './game-build-execution.ts';
import { gameDesignDigest } from '../../core/projects/game-build-status.ts';
import {
  taskDocumentUpdates,
  assertDocumentUpdateBaseline,
} from '../../core/ai/task-document-updates.ts';
import { assertGameBuildEditingLock } from '../../core/projects/game-build-editing.ts';
import type {
  AiExecutor,
  PreparedAiRun,
  AiProcessEvent,
  AiExecutionResult,
} from './ai-executor.ts';
import {
  appendGameBuild,
  readGameBuild,
  readGameBuildIndex,
  type GameBuildCodec,
} from '../../core/projects/game-build.ts';
import {
  createGameBuildRevision,
  gameBuildPublicationPaths,
} from '../../core/projects/game-build-publication.ts';

export type AiPublication = {
  history: Omit<HistoryEntry, 'files'>;
  lockBaseline: Snapshot;
  fileLock: AiFileLock;
  cancelled: () => boolean;
  requiresLease: boolean;
  shared?: { finish(changes: Snapshot): Promise<unknown> };
  phase: (phase: string) => void;
};

/** Owns staged workflow validation and publication; no process, Electron or global session. */
export class AiRunService {
  readonly stages: string[];
  stageIndex = 0;
  private phaseBaseline: Snapshot;
  readonly baseline: Snapshot;
  readonly taskPath: string;
  private readonly workspace: AiStageWorkspace;
  private readonly repository: LocalProjectRepository;
  private readonly validateHtml: (
    raw: string,
    relative: string,
  ) => Promise<unknown>;
  private readonly now: () => number;
  private buildSnapshot: Snapshot = {};
  private buildOptions?: {
    execution: GameBuildExecutionPort;
    executor: AiExecutor;
    codec: GameBuildCodec;
    id(): string;
  };
  executePhase?: (
    prepared: PreparedAiRun,
    signal: AbortSignal,
    emit: (event: AiProcessEvent) => void,
  ) => Promise<AiExecutionResult>;
  constructor(
    baseline: Snapshot,
    taskPath: string,
    workspace: AiStageWorkspace,
    repository: LocalProjectRepository,
    validateHtml: (raw: string, relative: string) => Promise<unknown>,
    now: () => number = Date.now,
    build?: {
      execution: GameBuildExecutionPort;
      executor: AiExecutor;
      codec: GameBuildCodec;
      id(): string;
    },
  ) {
    this.baseline = baseline;
    this.taskPath = taskPath;
    this.workspace = workspace;
    this.repository = repository;
    this.validateHtml = validateHtml;
    this.now = now;
    this.stages = workflowStages(baseline[taskPath]);
    this.phaseBaseline = baseline;
    if (gameBuildTask(baseline[taskPath])) {
      if (!build)
        throw Error('게임 소스 제작 도구를 지원하는 앱으로 업데이트해주세요.');
      this.buildOptions = build;
      this.executePhase = (prepared, signal, emit) =>
        this.executeBuildPhase(prepared, signal, emit);
    }
  }
  private async executeBuildPhase(
    prepared: PreparedAiRun,
    signal: AbortSignal,
    emit: (event: AiProcessEvent) => void,
  ): Promise<AiExecutionResult> {
    const options = this.buildOptions!,
      raw = this.stages.length
        ? this.stages[this.stageIndex]
        : this.baseline[this.taskPath];
    if (!gameBuildTask(raw))
      return options.executor.run(prepared, signal, emit);
    const files = await this.workspace.capture(),
      data = matter(raw).data,
      output = expectedArtifacts(raw)[0];
    const prior = readGameBuildIndex(files).artifacts.find(
      (a) => a.path === (data.base_html ?? output),
    );
    const previous = prior
      ? readGameBuild(files, prior.buildId, options.codec)
      : undefined;
    const scoped = aiLockedSnapshot(files, taskFileLock(files, this.taskPath));
    const built = await options.execution.execute(
      {
        prepared,
        specification: raw,
        inputs: scoped,
        previousLock: previous?.lock,
        previousDocuments: previous?.manifest.documents.map((d) => ({
          ...d,
          currentSha256:
            scoped[d.path] === undefined
              ? null
              : options.codec.digest(scoped[d.path]),
          identityMatches:
            scoped[d.path] !== undefined &&
            matter(scoped[d.path]).data.id === d.id,
        })),
        previousSource: previous?.manifest.htmlTemplate
          ? {
              plan: {
                version: 1,
                entry: previous.manifest.entry,
                html: previous.manifest.htmlTemplate,
                files: previous.manifest.sources.map((s) => s.path),
                assets: previous.manifest.assets.map(({ key, path }) => ({
                  key,
                  path,
                })),
              },
              sources: previous.sources,
            }
          : undefined,
      },
      signal,
      emit,
    );
    signal.throwIfAborted();
    const current = readGameBuildIndex(files).artifacts.find(
        (a) => a.path === output,
      ),
      buildId = options.id(),
      artifactId = current?.artifactId ?? options.id();
    const documents = Object.entries(scoped)
      .filter(([p]) => /^(?:project\.md|(?:docs|ideas)\/.+\.md)$/.test(p))
      .flatMap(([path, text]) => {
        const id = matter(text).data.id;
        return typeof id === 'string'
          ? [
              {
                path,
                id,
                sha256: options.codec.digest(text),
                designSha256: gameDesignDigest(
                  text,
                  matter,
                  options.codec.digest,
                ),
              },
            ]
          : [];
      });
    const revision = createGameBuildRevision(
      {
        built,
        artifactId,
        buildId,
        output,
        documents,
        instructionsVersion: `2:${options.codec.digest(JSON.stringify(data.effective_instructions ?? raw))}`,
        assetHashes: Object.fromEntries(
          built.plan.assets.map((a) => [
            a.path,
            options.codec.digest(files[a.path]),
          ]),
        ),
      },
      options.codec,
    );
    const bundle = {
      ...Object.fromEntries(
        Object.entries(built.sources).map(([p, text]) => [
          `${revision.prefix}/source/${p}`,
          text,
        ]),
      ),
      [`${revision.prefix}/manifest.json`]: JSON.stringify(revision.manifest),
      [`${revision.prefix}/dependencies.lock.json`]: revision.lock,
      [`${revision.prefix}/notices.json`]: revision.notices,
    };
    const candidate = appendGameBuild(
      { ...files, [output]: this.baseline[output] ?? '' },
      bundle,
      { artifactId, buildId, path: output },
      built.html,
      options.codec,
    );
    this.buildSnapshot = Object.fromEntries(
      gameBuildPublicationPaths(files, candidate, [output], options.codec).map(
        (p) => [p, candidate[p]],
      ),
    );
    await this.workspace.write(output, built.html);
    return { code: 0 };
  }
  inspectInput() {
    const specification = this.baseline[this.taskPath];
    const data = matter(specification).data;
    if (this.buildOptions || data.document_updates !== undefined)
      assertDocumentUpdateBaseline(
        taskDocumentUpdates(
          data.document_updates,
          data.inputs ?? [],
          expectedArtifacts(specification),
        ),
        this.baseline,
        matter,
      );
    assertCanvas(this.baseline, matter(specification).data.canvas_id);
    const outputs = expectedArtifacts(specification);
    validateHtmlAnalysis(specification, this.baseline);
    if (newOutputsAlreadyExist(specification, this.baseline))
      throw new CanvasError(
        'GC-AI-004',
        '이미 생성된 새 버전입니다. 다른 버전을 만들거나 기존 결과 업데이트를 선택해주세요.',
      );
    return outputs;
  }
  async preparePhase() {
    await this.workspace.write(this.taskPath, this.stages[this.stageIndex]);
    this.phaseBaseline = await this.workspace.capture();
  }
  /** A write-only executor receives only the current task's protected snapshot. */
  async inputFiles() {
    const files = await this.workspace.capture();
    return aiLockedSnapshot(files, taskFileLock(files, this.taskPath));
  }
  async embedAssets(provider: AiProviderId) {
    if (
      this.buildOptions &&
      gameBuildTask(
        this.stages[this.stageIndex] ?? this.baseline[this.taskPath],
      )
    )
      return;
    if (provider === 'codex-cli') return;
    const specification = this.stages.length
      ? this.stages[this.stageIndex]
      : this.baseline[this.taskPath];
    const files = await this.workspace.capture();
    for (const relative of expectedArtifacts(specification).filter((file) =>
      file.endsWith('.html'),
    )) {
      if (files[relative] === undefined) continue;
      const embedded = embedSelectedAssets(
        files[relative],
        specification,
        files,
      );
      if (embedded !== files[relative])
        await this.workspace.write(relative, embedded);
    }
  }
  async advance() {
    const staged = await this.workspace.capture();
    const docOutputs = resolveTaskArtifacts(
      this.stages[0],
      staged,
      this.phaseBaseline,
    );
    assertStageInputs(this.phaseBaseline, staged, docOutputs);
    validateArtifacts(this.phaseBaseline, staged, docOutputs);
    validateHtmlAnalysis(this.stages[0], staged, docOutputs);
    const next = matter(this.stages[1]);
    next.data.inputs = [...new Set([...next.data.inputs, ...docOutputs])];
    if (next.data.task_context) {
      next.data.task_context = validateTaskDesignContext(
        {
          ...next.data.task_context,
          designDocuments: [
            ...new Set([
              ...next.data.task_context.designDocuments,
              ...docOutputs,
            ]),
          ],
        },
        [...next.data.inputs, ...next.data.expected_outputs],
      );
    }
    this.stages[1] = matter.stringify(
      `${next.content}\n## 이번에 생성한 문서 전체\n\n${docOutputs.map((path) => `- \`${path}\``).join('\n')}\n${next.data.task_context ? `\n## 이번 단계의 제작 기준\n\n${taskDesignContextRules(next.data.task_context)}\n` : ''}`,
      next.data,
    );
  }
  async validateFinal(
    onOutputs: (outputs: string[]) => void,
    phase: (value: string) => void,
  ) {
    let staged = await this.workspace.capture();
    phase('artifact-validation');
    if (this.stages.length) {
      assertStageInputs(
        this.phaseBaseline,
        staged,
        expectedArtifacts(this.stages[this.stageIndex]),
      );
      await this.workspace.write(this.taskPath, this.baseline[this.taskPath]);
      staged = { ...staged, [this.taskPath]: this.baseline[this.taskPath] };
    }
    const outputs = resolveTaskArtifacts(
      this.baseline[this.taskPath],
      staged,
      this.baseline,
    );
    // Record resolved paths before validation so failed bundles remain diagnosable.
    onOutputs(outputs);
    assertStageInputs(this.baseline, staged, outputs);
    validateArtifacts(this.baseline, staged, outputs);
    validateHtmlAnalysis(this.baseline[this.taskPath], staged, outputs);
    phase('html-validation');
    for (const relative of outputs.filter(isPreviewPath))
      await this.validateHtml(staged[relative], relative);
    if (this.buildOptions) {
      staged = { ...staged, ...this.buildSnapshot };
      const data = matter(this.baseline[this.taskPath]).data;
      assertGameBuildEditingLock(
        this.baseline,
        staged,
        data.base_html ?? outputs.find(isPreviewPath),
        outputs.find(isPreviewPath)!,
      );
      gameBuildPublicationPaths(
        this.baseline,
        staged,
        outputs,
        this.buildOptions.codec,
      );
    }
    return { staged, outputs };
  }
  async publish(staged: Snapshot, outputs: string[], input: AiPublication) {
    const current = await this.repository.capture();
    const publicationBaseline = this.buildOptions ? current : this.baseline;
    input.phase('input-conflict');
    const external = changedAiFile(input.lockBaseline, current, input.fileLock);
    if (external)
      throw new CanvasError(
        'GC-SYNC-001',
        `작업 중 외부 변경을 발견했습니다. 결과를 보류합니다: ${external}`,
      );
    const taskData = matter(this.baseline[this.taskPath]).data;
    if (this.buildOptions) {
      const basePath = taskData.base_html ?? outputs.find(isPreviewPath);
      const prior = readGameBuildIndex(this.baseline).artifacts.find(
        (a) => a.path === basePath,
      );
      const currentBase = readGameBuildIndex(current).artifacts.find(
        (a) => a.path === basePath,
      );
      if (JSON.stringify(prior) !== JSON.stringify(currentBase))
        throw new CanvasError(
          'GC-SYNC-001',
          '기준 게임의 제작 버전이 변경되었습니다. 최신 상태에서 다시 실행해주세요.',
        );
    }
    let artifacts = Object.fromEntries(
      outputs.map((relative) => {
        if (!relative.startsWith('docs/') || !relative.endsWith('.md'))
          return [relative, staged[relative]];
        const parsed = matter(staged[relative]);
        const grouping =
          readProjectLayout(current) &&
          taskData.document_output_mode !== undefined &&
          !parsed.data.document_bundle_id &&
          !parsed.data.document_bundle
            ? {
                document_bundle_id: `format-${taskData.id}`,
                document_output: {
                  key: `d${outputs.indexOf(relative) + 1}`,
                  instructions: '',
                },
              }
            : {};
        return [
          relative,
          matter.stringify(parsed.content, {
            ...parsed.data,
            ...grouping,
            creation_origin: 'ai',
            ai_task_path: this.taskPath,
          }),
        ];
      }),
    );
    if (this.buildOptions) {
      const paths = gameBuildPublicationPaths(
        this.baseline,
        staged,
        outputs,
        this.buildOptions.codec,
      );
      const artifact = readGameBuildIndex(staged).artifacts.find((a) =>
        outputs.includes(a.path),
      )!;
      const bundle = Object.fromEntries(
        paths
          .filter((p) => p !== '.game-builds/index.json')
          .map((p) => [p, staged[p]]),
      );
      const merged = appendGameBuild(
        current,
        bundle,
        artifact,
        staged[artifact.path],
        this.buildOptions.codec,
      );
      artifacts = {
        ...artifacts,
        ...Object.fromEntries(paths.map((p) => [p, merged[p]])),
      };
    }
    let changes = input.shared
      ? artifacts
      : layoutNewDocuments(current, artifacts, {
          x: Number.isFinite(taskData.x) ? taskData.x : 120,
          y: Number.isFinite(taskData.y) ? taskData.y : 120,
          canvasId: canvasId(taskData.canvas_id),
        });
    const initialized = initializeWorkflows(
      current,
      { ...current, ...changes },
      true,
    );
    changes = Object.fromEntries(
      Object.keys(changes).map((path) => [path, initialized[path]]),
    );
    validateArtifacts(current, { ...current, ...changes }, outputs);
    const previous = Object.fromEntries(
      Object.keys(changes)
        .filter((relative) => publicationBaseline[relative] !== undefined)
        .map((relative) => [relative, publicationBaseline[relative]]),
    );
    input.phase('publish');
    if (input.shared) {
      await input.shared.finish(changes);
    } else if (input.requiresLease) {
      throw new Error(
        '공동 AI 작업의 실행 권한이 만료되어 결과를 반영하지 않습니다.',
      );
    } else {
      await this.repository.saveHistory(previous, changes, {
        ...input.history,
        status: 'validating',
      });
      await this.repository.apply(
        publicationBaseline,
        changes,
        input.cancelled,
      );
      try {
        if (input.cancelled()) throw new Error('결과 반영을 중지했습니다.');
        await this.repository.saveHistory(previous, changes, {
          ...input.history,
          status: 'completed',
          finishedAt: this.now(),
        });
      } catch (error) {
        await this.repository.apply(
          changes,
          Object.fromEntries(
            Object.keys(changes).map((relative) => [
              relative,
              publicationBaseline[relative] ?? null,
            ]),
          ),
        );
        throw error;
      }
    }
  }
}
