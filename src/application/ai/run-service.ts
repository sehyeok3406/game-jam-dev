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
  constructor(
    baseline: Snapshot,
    taskPath: string,
    workspace: AiStageWorkspace,
    repository: LocalProjectRepository,
    validateHtml: (raw: string, relative: string) => Promise<unknown>,
    now: () => number = Date.now,
  ) {
    this.baseline = baseline;
    this.taskPath = taskPath;
    this.workspace = workspace;
    this.repository = repository;
    this.validateHtml = validateHtml;
    this.now = now;
    this.stages = workflowStages(baseline[taskPath]);
    this.phaseBaseline = baseline;
  }
  inspectInput() {
    const specification = this.baseline[this.taskPath];
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
    this.stages[1] = matter.stringify(
      `${next.content}\n## 이번에 생성한 문서 전체\n\n${docOutputs.map((path) => `- \`${path}\``).join('\n')}\n`,
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
    return { staged, outputs };
  }
  async publish(staged: Snapshot, outputs: string[], input: AiPublication) {
    const current = await this.repository.capture();
    input.phase('input-conflict');
    const external = changedAiFile(input.lockBaseline, current, input.fileLock);
    if (external)
      throw new CanvasError(
        'GC-SYNC-001',
        `작업 중 외부 변경을 발견했습니다. 결과를 보류합니다: ${external}`,
      );
    const taskData = matter(this.baseline[this.taskPath]).data;
    const artifacts = Object.fromEntries(
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
        .filter((relative) => this.baseline[relative] !== undefined)
        .map((relative) => [relative, this.baseline[relative]]),
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
      await this.repository.apply(this.baseline, changes, input.cancelled);
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
              this.baseline[relative] ?? null,
            ]),
          ),
        );
        throw error;
      }
    }
  }
}
