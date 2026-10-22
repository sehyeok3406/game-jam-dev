import type { LocalSectionRepository } from '../ports/section-repository.ts';
import type { DocumentRepository } from '../ports/local-project-repository.ts';
import type { MarkdownCodec } from '../ports/markdown-codec.ts';
import type { CanvasDocument } from '../../contracts/documents.ts';
import type {
  DeleteSectionInput,
  DeleteSectionResult,
  SectionLayoutUpdate,
} from '../../contracts/canvas.ts';

type SectionPorts = {
  sections: LocalSectionRepository;
  documents: DocumentRepository;
  markdown: MarkdownCodec;
  listDocuments: () => Promise<CanvasDocument[]>;
  trash: (paths: string[]) => Promise<void>;
  reportError: (message: string, error: unknown) => void;
};
/** Local membership/lifecycle rules keep their existing file and recycle-bin behavior. */
export class LocalSectionService {
  private ports: SectionPorts;
  constructor(ports: SectionPorts) {
    this.ports = ports;
  }
  private assertPath(relative: string) {
    if (
      typeof relative !== 'string' ||
      !relative.startsWith('sections/') ||
      !relative.toLowerCase().endsWith('.md') ||
      relative.includes('\\') ||
      relative.split('/').some((part) => !part || part === '..' || part === '.')
    )
      throw Error('섹션 경로를 확인해주세요.');
  }
  async delete(input: DeleteSectionInput): Promise<DeleteSectionResult> {
    this.assertPath(input.relativePath);
    if (typeof input.deleteMembers !== 'boolean')
      throw Error('섹션 문서 삭제 여부를 확인해주세요.');
    const section = await this.ports.sections.read(input.relativePath);
    if (section.id !== input.sectionId) {
      throw new Error('삭제할 섹션을 확인할 수 없습니다.');
    }

    let deletedDocumentCount = 0;
    let preservedDocumentCount = section.members.length;
    const deletedMemberKeys = new Set<string>();

    if (input.deleteMembers) {
      const documents = await this.ports.listDocuments();
      const memberKeys = new Set(
        section.members.flatMap((member) => [member.id, member.path]),
      );
      const memberDocuments = documents.filter(
        (document) =>
          memberKeys.has(document.id) || memberKeys.has(document.relativePath),
      );
      const deletableDocuments = memberDocuments;
      preservedDocumentCount =
        memberDocuments.length - deletableDocuments.length;

      for (const document of deletableDocuments) {
        await this.ports.trash([document.relativePath]);
        deletedDocumentCount += 1;
        deletedMemberKeys.add(document.id);
        deletedMemberKeys.add(document.relativePath);
      }
    }

    await this.ports.trash([section.relativePath]);

    if (deletedMemberKeys.size > 0) {
      const remainingSections = await this.ports.sections.list();
      for (const remainingSection of remainingSections) {
        const remainingMembers = remainingSection.members.filter(
          (member) =>
            !deletedMemberKeys.has(member.id) &&
            !deletedMemberKeys.has(member.path),
        );
        if (remainingMembers.length !== remainingSection.members.length) {
          await this.ports.sections.write(remainingSection.relativePath, {
            id: remainingSection.id,
            title: remainingSection.title,
            x: remainingSection.x,
            y: remainingSection.y,
            width: remainingSection.width,
            height: remainingSection.height,
            members: remainingMembers,
          });
        }
      }
    }

    return { deletedDocumentCount, preservedDocumentCount };
  }
  async updateLayout(input: SectionLayoutUpdate) {
    this.assertPath(input.relativePath);
    if (
      ![input.x, input.y, input.width, input.height].every(
        (value) =>
          typeof value === 'number' &&
          Number.isFinite(value) &&
          Math.abs(value) <= 1_000_000,
      )
    )
      throw Error('캔버스 좌표/크기가 올바르지 않습니다.');
    const section = await this.ports.sections.read(input.relativePath);
    if (input.objectId !== undefined && input.objectId !== section.id)
      throw Error('섹션이 변경되었습니다. 목록을 새로고침해주세요.');
    const deltaX = input.x - section.x;
    const deltaY = input.y - section.y;
    const currentDocuments = await this.ports.listDocuments();
    const resolvedMembers = section.members.map((member) => {
      const currentDocument = currentDocuments.find(
        (document) =>
          document.id === member.id || document.relativePath === member.path,
      );
      return {
        id: member.id,
        path: currentDocument?.relativePath ?? member.path,
      };
    });

    if (input.moveMembers !== false && (deltaX !== 0 || deltaY !== 0)) {
      await Promise.all(
        resolvedMembers.map(async (member) => {
          try {
            const current = await this.ports.documents.read(member.path);
            const parsed = this.ports.markdown.parse(current.raw);
            const currentX =
              typeof parsed.data.x === 'number' ? parsed.data.x : section.x;
            const currentY =
              typeof parsed.data.y === 'number' ? parsed.data.y : section.y;
            parsed.data.x = Math.round(currentX + deltaX);
            parsed.data.y = Math.round(currentY + deltaY);
            await this.ports.documents.patchMetadata(member.path, current.raw, {
              x: parsed.data.x,
              y: parsed.data.y,
            });
          } catch (error) {
            this.ports.reportError(
              `Failed to move section member ${member.path}`,
              error,
            );
          }
        }),
      );
    }

    await this.ports.sections.write(section.relativePath, {
      id: section.id,
      title: section.title,
      x: input.x,
      y: input.y,
      width: Math.max(input.width, 420),
      height: Math.max(input.height, 280),
      members: resolvedMembers,
    });
  }
}
