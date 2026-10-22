import type { SaveDocumentInput } from '../../contracts/documents.ts';

/** Shared calculation; transport-specific size/version/authorization checks stay at their boundary. */
export function documentEditContent(
  input: Pick<SaveDocumentInput, 'title' | 'body'>,
) {
  if (typeof input.title !== 'string' || typeof input.body !== 'string')
    throw Error('저장할 문서 내용이 올바르지 않습니다.');
  return { title: input.title.trim() || '제목 없음', body: input.body };
}

export function assertDocumentBase(
  current: { id: string; title: unknown; body: string },
  input: SaveDocumentInput,
) {
  if (input.objectId && input.objectId !== current.id)
    throw Error('문서 식별자가 변경되었습니다. 초안은 보관됩니다.');
  if (
    input.expectedBody !== undefined &&
    (current.body !== input.expectedBody ||
      current.title !== input.expectedTitle)
  )
    throw Error('문서가 외부에서 변경되었습니다. 초안은 보관됩니다.');
}
