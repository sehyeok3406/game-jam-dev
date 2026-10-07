import { createHash } from 'node:crypto';
import matter from './markdown.ts';
import { snapshotDocuments, snapshotSections } from './collaboration-model.ts';
import { isPreviewPath, previewLabel } from './preview-output.ts';
import type { Snapshot } from './project-store.ts';

export const WEB_VIEWER_URL = 'https://game-jam-web-viewer.vercel.app';
export type WebProject = {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  source: 'shared' | 'published' | 'local-live';
  revision: number;
  readOnly: true;
  publishedAt: number;
  modifiedAt: number;
  folder?: string;
  sections: {
    id: string;
    title: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
  documents: {
    id: string;
    title: string;
    kind: 'idea' | 'document' | 'image' | 'html';
    section: string;
    summary: string;
    body: string;
    position: { x: number; y: number };
    width: number;
    height: number;
    color: 'cream' | 'green' | 'blue' | 'rose' | 'purple' | 'gray';
    image?: string;
    html?: string;
  }[];
};

// Opaque web IDs: never send a local absolute path or a collaboration credential.
export function webProjectId(libraryId: string) {
  return createHash('sha256').update(libraryId).digest('hex');
}

export function projectForWeb(input: {
  libraryId: string;
  name: string;
  files: Snapshot;
  source: WebProject['source'];
  revision?: number;
  folder?: string;
}): WebProject {
  const sections = snapshotSections(input.files);
  const documents = snapshotDocuments(input.files)
    .filter(
      (doc) => !doc.relativePath.startsWith('.ai/') && doc.type !== 'ai-task',
    )
    .map((doc) => {
      const html = doc.htmlSource ? input.files[doc.htmlSource] : undefined;
      const image = doc.asset ? input.files[doc.asset.path] : undefined;
      const section = sections.find((group) =>
        group.members.some((member) => member.path === doc.relativePath),
      );
      const colors = {
        default: 'cream',
        yellow: 'cream',
        green: 'green',
        blue: 'blue',
        pink: 'rose',
        purple: 'purple',
        gray: 'gray',
      } as const;
      return {
        id: doc.id,
        title: doc.title,
        kind: html
          ? ('html' as const)
          : doc.type === 'image'
            ? ('image' as const)
            : doc.type === 'idea'
              ? ('idea' as const)
              : ('document' as const),
        section: section?.title ?? '분류 없음',
        summary: doc.body
          .replace(/[#*_`>[\]]/g, '')
          .replace(/\s+/g, ' ')
          .slice(0, 140),
        body: doc.body,
        position: { x: doc.x, y: doc.y },
        width: doc.width,
        height: doc.height,
        color: colors[doc.backgroundColor ?? 'default'],
        ...(image ? { image } : {}),
        ...(html ? { html } : {}),
        modifiedAt: doc.modifiedAt,
      };
    });
  const linked = new Set(
    snapshotDocuments(input.files)
      .map((doc) => doc.htmlSource)
      .filter(Boolean),
  );
  for (const [relative, html] of Object.entries(input.files)) {
    if (!isPreviewPath(relative) || linked.has(relative)) continue;
    documents.push({
      id: `html-${webProjectId(relative)}`,
      title: previewLabel(relative),
      kind: 'html',
      section: '게임 결과',
      summary: '프로젝트에서 만든 HTML 결과입니다.',
      body: '',
      position: { x: 120 + documents.length * 380, y: 120 },
      width: 340,
      height: 300,
      color: 'blue',
      html,
      modifiedAt: 0,
    });
  }
  const overview = input.files['project.md']
    ? matter(input.files['project.md'])
    : null;
  return {
    schemaVersion: 1,
    id: webProjectId(input.libraryId),
    name:
      typeof overview?.data.title === 'string' && input.source !== 'shared'
        ? overview.data.title
        : input.name,
    description:
      overview?.content
        .replace(/[#*_`>]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180) ?? '',
    source: input.source,
    revision: input.revision ?? 0,
    readOnly: true,
    publishedAt: Date.now(),
    modifiedAt: Math.max(0, ...documents.map((doc) => doc.modifiedAt)),
    ...(input.folder ? { folder: input.folder } : {}),
    sections: sections.map(({ id, title, x, y, width, height }) => ({
      id,
      title,
      x,
      y,
      width,
      height,
    })),
    documents: documents.map(({ modifiedAt: _modifiedAt, ...doc }) => doc),
  };
}

export async function publishWebProject(project: WebProject, token: string) {
  const body = JSON.stringify(project);
  // Vercel Functions accept 4.5 MB. Fail visibly; never publish an incomplete project.
  if (Buffer.byteLength(body) > 4_000_000)
    throw new Error(
      '웹 게시본이 4MB를 초과합니다. 큰 이미지·HTML을 줄인 뒤 다시 게시해주세요.',
    );
  const response = await fetch(`${WEB_VIEWER_URL}/api/publish`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body,
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  });
  if (!response.ok)
    throw new Error(
      `웹 게시에 실패했습니다 (${response.status}). 웹 뷰어 연결 설정을 확인해주세요.`,
    );
}
