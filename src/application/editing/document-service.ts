import { isAssetPath } from '../../file-assets.ts';
import { CanvasError } from '../../app-errors.ts';
import { layoutValues } from '../../core/editing/layout.ts';
import type { LayoutUpdate } from '../../contracts/canvas.ts';
import type { SetDocumentCollapsedInput } from '../../contracts/documents.ts';
import type { SaveDocumentInput } from '../../contracts/documents.ts';
import type { DocumentRepository } from '../ports/local-project-repository.ts';
import {
  assertDocumentBase,
  documentEditContent,
} from '../../core/editing/document-edit.ts';

export class DocumentEditingService {
  private repository: DocumentRepository;
  constructor(repository: DocumentRepository) {
    this.repository = repository;
  }
  asset(relative: string) {
    if (!isAssetPath(relative))
      throw new CanvasError(
        'GC-IMPORT-002',
        '프로젝트 이미지 경로가 올바르지 않습니다.',
      );
    return this.repository.asset(relative);
  }
  async read(relative: string) {
    try {
      return (await this.repository.read(relative)).document;
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return null;
      throw error;
    }
  }
  async setCollapsed(input: SetDocumentCollapsedInput) {
    if (typeof input.collapsed !== 'boolean')
      throw Error('문서 접기 상태가 올바르지 않습니다.');
    const current = await this.repository.read(input.relativePath);
    await this.repository.patchMetadata(input.relativePath, current.raw, {
      collapsed: input.collapsed,
    });
  }
  async updateLayout(input: LayoutUpdate) {
    const current = await this.repository.read(input.relativePath);
    if (input.objectId !== undefined && input.objectId !== current.document.id)
      throw Error('문서 식별자가 변경되었습니다. 목록을 새로고침해주세요.');
    const layout = layoutValues(current.document, input);
    await this.repository.patchMetadata(input.relativePath, current.raw, {
      ...(input.position === false ? {} : { x: layout.x, y: layout.y }),
      ...(input.size === false
        ? {}
        : { width: layout.width, height: layout.height }),
    });
  }
  async save(input: SaveDocumentInput) {
    const current = await this.repository.read(input.relativePath);
    assertDocumentBase(
      {
        id: current.document.id,
        title: current.storedTitle,
        body: current.document.body,
      },
      input,
    );
    return this.repository.replace(
      input.relativePath,
      current.raw,
      documentEditContent(input),
    );
  }
}
