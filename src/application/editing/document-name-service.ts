import type {
  RenameDocumentInput,
  RenameDocumentResult,
  ApplyFileNamesInput,
} from '../../contracts/document-names.ts';
import type {
  DocumentRepository,
  LocalProjectRepository,
} from '../ports/local-project-repository.ts';
import type { MarkdownCodec } from '../ports/markdown-codec.ts';
import type { LayoutMarkdownLinks } from '../projects/layout-migration.ts';
import type { PreviewNameCodec } from '../ports/preview-names.ts';
import { planDocumentName } from './document-name-plan.ts';
export { planDocumentName } from './document-name-plan.ts';
import { planPreviewName } from './preview-name-plan.ts';
import { inspectFileNames, applyFileNamePlan } from './file-name-plan.ts';
type DocumentNamePorts = {
  html?: PreviewNameCodec;
  project: LocalProjectRepository;
  documents: DocumentRepository;
  markdown: MarkdownCodec;
  links: LayoutMarkdownLinks;
};
export class DocumentNameService {
  private ports: DocumentNamePorts;
  constructor(ports: DocumentNamePorts) {
    this.ports = ports;
  }
  async rename(input: RenameDocumentInput): Promise<RenameDocumentResult> {
    const p = this.ports;
    const plan = planDocumentName(
      await p.project.capture(),
      input,
      p.markdown,
      p.links,
    );
    await p.project.apply(plan.before, plan.changes);
    return {
      document: (await p.documents.read(plan.change.to)).document,
      change: plan.change,
      affectedPaths: Object.keys(plan.changes),
    };
  }
  async inspect(scope: string) {
    if (!this.ports.html) throw Error('파일 이름 통일을 사용할 수 없습니다.');
    return inspectFileNames(
      await this.ports.project.capture(),
      scope,
      this.ports.markdown,
      this.ports.html,
      this.ports.links,
    );
  }
  async unify(input: ApplyFileNamesInput) {
    if (!this.ports.html) throw Error('파일 이름 통일을 사용할 수 없습니다.');
    const plan = applyFileNamePlan(
      await this.ports.project.capture(),
      input,
      this.ports.markdown,
      this.ports.links,
      this.ports.html,
    );
    await this.ports.project.apply(plan.before, plan.changes);
    return plan.affectedPaths;
  }
  async renamePreview(
    input: import('../../contracts/document-names.ts').RenamePreviewInput,
  ): Promise<import('../../contracts/document-names.ts').RenamePreviewResult> {
    if (!this.ports.html) throw Error('HTML 이름 변경을 사용할 수 없습니다.');
    const p = this.ports,
      html = p.html!;
    const plan = planPreviewName(
      await p.project.capture(),
      input,
      p.markdown,
      p.links,
      html,
    );
    await p.project.apply(plan.before, plan.changes);
    return {
      preview: html.describe(plan.files, plan.change.to),
      change: plan.change,
      affectedPaths: Object.keys(plan.changes),
    };
  }
}
