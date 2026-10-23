import { normalizeSectionMembers } from '../../core/editing/section-members.ts';
import type {
  DocumentRepository,
  LocalProjectRepository,
} from '../ports/local-project-repository.ts';
import type { MarkdownCodec } from '../ports/markdown-codec.ts';
import type { CommandEnvironment } from '../../core/editing/environment.ts';
import type {
  CanvasDocument,
  CreateIdeaInput,
  DuplicateDocumentsInput,
} from '../../contracts/documents.ts';
import type { CreateSectionInput } from '../../contracts/canvas.ts';
import type { CreateTaskInput } from '../../contracts/ai.ts';
import { LocalCommandService } from './command-service.ts';
import { assertCanvas, canvasId } from '../../canvas-sheets.ts';
import { createTaskFiles } from '../../task-plan.ts';

export type LocalCreationPorts = {
  project: LocalProjectRepository;
  documents: DocumentRepository;
  markdown: MarkdownCodec;
  environment: CommandEnvironment;
  validatePath: (relative: string) => Promise<void>;
};

/** Keeps local filenames/IDs and publishes a complete copy/task plan atomically. */
export class LocalCreationService {
  private ports: LocalCreationPorts;
  constructor(ports: LocalCreationPorts) {
    this.ports = ports;
  }
  createIdea(input: CreateIdeaInput) {
    return new LocalCommandService(
      this.ports.project,
      this.ports.environment,
    ).execute('documents:create-idea', input);
  }
  createSection(input: CreateSectionInput) {
    return new LocalCommandService(
      this.ports.project,
      this.ports.environment,
    ).execute('sections:create', input);
  }
  async duplicate(input: DuplicateDocumentsInput): Promise<CanvasDocument[]> {
    const members = normalizeSectionMembers(input.documents);
    if (!members.length) return [];
    const { project, documents, markdown, environment } = this.ports;
    const before = await project.capture();
    const offsetX = Number.isFinite(input.offsetX) ? input.offsetX : 32;
    const offsetY = Number.isFinite(input.offsetY) ? input.offsetY : 32;
    const changes: Record<string, string> = {};
    const paths: string[] = [];
    for (const member of members) {
      const current = await documents.read(member.path),
        source = current.document;
      if (source.id !== member.id)
        throw Error(`복사할 문서를 확인할 수 없습니다: ${member.path}`);
      const parsed = markdown.parse(current.raw);
      const suffix = environment.id().slice(0, 8);
      const segments = source.relativePath.split('/');
      const filename = segments.pop()!;
      const directory =
        source.relativePath === 'project.md' ? 'docs' : segments.join('/');
      const relative = `${directory}/${filename.slice(0, -3)}-copy-${suffix}.md`;
      if (
        Object.keys({ ...before, ...changes }).some(
          (path) => path.toLowerCase() === relative.toLowerCase(),
        )
      )
        throw Error('복사할 문서 경로가 중복되었습니다. 다시 시도해주세요.');
      changes[relative] = markdown.stringify(parsed.content, {
        ...parsed.data,
        canvas_id:
          input.canvasId !== undefined
            ? assertCanvas(before, input.canvasId)
            : canvasId(parsed.data.canvas_id),
        id: `${source.id}-copy-${suffix}`,
        title: `${source.title} 복사본`,
        x: Math.round(source.x + offsetX),
        y: Math.round(source.y + offsetY),
        width: Math.round(source.width),
        height: Math.round(source.height),
      });
      paths.push(relative);
    }
    await project.apply(before, changes);
    return Promise.all(
      paths.map(async (relative) => (await documents.read(relative)).document),
    );
  }
  async createTask(input: CreateTaskInput) {
    if (!input.inputPaths.length) throw Error('문서를 하나 이상 선택해주세요.');
    const { project, documents, environment, validatePath } = this.ports;
    await Promise.all(
      input.inputPaths
        .filter((path) => !path.startsWith('canvas-text:'))
        .map(validatePath),
    );
    const before = await project.capture();
    const stamp = new Date(environment.now())
      .toISOString()
      .replace(/[:.]/g, '-');
    const id = `${input.thenImplement ? 'gamejam' : input.kind}-${stamp}-${environment.id().slice(0, 8)}`;
    const relative = `.ai/tasks/${id}.md`;
    await project.apply(before, createTaskFiles(input, id, before));
    return (await documents.read(relative)).document;
  }
}
