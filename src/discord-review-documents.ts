import { createHash } from 'node:crypto';
import type { GamejamApproval } from './gamejam-approval.ts';

export type ReviewDocument = { path: string; content: string; sha256: string };
export type ApprovalDocuments = {
  requestId: string;
  revision: number;
  reviewToken: string;
  capturedAt: number;
  documents: ReviewDocument[];
  unsupported: string[];
};
export type DiscordReviewSnapshot = ApprovalDocuments & {
  version: 1;
  id: string;
  item: GamejamApproval;
  providerId: string;
  modelId: string;
};
export type DiscordSnapshotReceipt = {
  id: string;
  revision: number;
  reviewToken: string;
  channelId: string;
  messageIds: string[];
  complete?: boolean;
  approvalCommandId?: string;
};

/** Only selected Markdown is exported. Never follow links or read the local disk. */
export function captureApprovalDocuments(
  item: GamejamApproval,
  files: Record<string, string>,
  reviewToken: string,
): ApprovalDocuments {
  const paths = [...new Set(item.request.inputPaths)];
  const markdown = paths.filter((p) => p.endsWith('.md') && !p.startsWith('.'));
  if (markdown.length > 30)
    throw Error(
      '디스코드 문서 검토는 한 요청에 Markdown 문서 30개까지 지원합니다. 앱에서 검토하거나 요청을 나눠주세요.',
    );
  let bytes = 0;
  const documents = markdown.map((path) => {
    const content = files[path];
    if (typeof content !== 'string')
      throw Error(
        '입력 문서가 변경되거나 삭제되었습니다. 요청을 다시 확인해주세요.',
      );
    bytes += Buffer.byteLength(content, 'utf8');
    if (bytes > 2 * 1024 * 1024)
      throw Error(
        '디스코드 검토 문서의 전체 크기는 2MB까지 지원합니다. 앱에서 검토하거나 요청을 나눠주세요.',
      );
    return {
      path,
      content,
      sha256: createHash('sha256').update(content).digest('hex'),
    };
  });
  return {
    requestId: item.id,
    revision: item.revision,
    reviewToken,
    capturedAt: Date.now(),
    documents,
    unsupported: paths.filter((p) => !markdown.includes(p)),
  };
}

/** Split by code point so Korean/emoji survive the UTF-16 character budget. */
export function discordTextPages(text: string, limit = 1500): string[] {
  const pages: string[] = [];
  let chunk = '';
  for (const char of text) {
    if (chunk.length + char.length > limit) {
      pages.push(chunk);
      chunk = '';
    }
    chunk += char;
  }
  if (chunk || !pages.length) pages.push(chunk || '(빈 문서)');
  return pages;
}
export function documentFilename(
  doc: ReviewDocument,
  index: number,
  revision: number,
) {
  const base =
    doc.path
      .split('/')
      .at(-1)!
      .replace(/[\\/:*?"<>|\r\n]/g, '_')
      .replace(/\.md$/, '')
      .slice(0, 70) || 'document';
  return `${index + 1}-${base}-r${revision}.md`;
}
