import fs from 'node:fs/promises';
import path from 'node:path';
import matter from '../../markdown.ts';
import type { CanvasDocument } from '../../contracts/documents.ts';
import { canvasId } from '../../canvas-sheets.ts';
import { imageAsset } from '../../file-assets.ts';
import { cardColor } from '../../card-colors.ts';
import { isPreviewPath } from '../../preview-output.ts';
import { normalizeSources } from '../../core/documents/source-references.ts';
import { projectPath } from '../../project-store.ts';
export const readDocument = async (
  root: string,
  absolutePath: string,
  contents?: string,
): Promise<CanvasDocument> => {
  const [raw, stat] = await Promise.all([
    contents === undefined
      ? fs.readFile(absolutePath, 'utf8')
      : Promise.resolve(contents),
    fs.stat(absolutePath),
  ]);
  const parsed = matter(raw);
  const relativePath = path.relative(root, absolutePath).replaceAll('\\', '/');
  const fallbackTitle = path.basename(absolutePath, '.md');
  const data = parsed.data as Record<string, unknown>;
  const asset = imageAsset(data.asset);
  let assetVersion: number | undefined;
  if (asset) {
    try {
      assetVersion = (await fs.stat(await projectPath(root, asset.path)))
        .mtimeMs;
    } catch {
      /* Keep the image card visible so the missing-file error can be shown. */
    }
  }
  const number = (key: string, fallback: number) =>
    typeof data[key] === 'number' ? data[key] : fallback;

  return {
    canvasId: canvasId(data.canvas_id),
    identitySource: typeof data.id === 'string' ? 'frontmatter' : 'path',
    id: typeof data.id === 'string' ? data.id : relativePath,
    title: typeof data.title === 'string' ? data.title : fallbackTitle,
    type:
      data.type === 'idea' ||
      data.type === 'system' ||
      data.type === 'overview' ||
      data.type === 'question' ||
      data.type === 'ai-task' ||
      data.type === 'reference' ||
      data.type === 'image'
        ? data.type
        : 'idea',
    status: typeof data.status === 'string' ? data.status : 'draft',
    statusPropertyEnabled:
      typeof data.status_property_enabled === 'boolean'
        ? data.status_property_enabled
        : undefined,
    workflowStatusId:
      typeof data.workflow_status_id === 'string'
        ? data.workflow_status_id
        : undefined,
    workflowOrder:
      typeof data.workflow_order === 'number' &&
      Number.isFinite(data.workflow_order)
        ? data.workflow_order
        : undefined,
    relativePath,
    body: parsed.content.trim(),
    x: number('x', 120),
    y: number('y', 120),
    width: number('width', 340),
    height: number('height', 300),
    collapsed: data.collapsed === true,
    backgroundColor: cardColor(data.background_color),
    sources: normalizeSources(data.sources),
    asset,
    systemId: typeof data.system_id === 'string' ? data.system_id : undefined,
    outputKey:
      typeof (data.document_output as { key?: unknown })?.key === 'string'
        ? (data.document_output as { key: string }).key
        : undefined,
    outputInstructions:
      typeof (data.document_output as { instructions?: unknown })
        ?.instructions === 'string'
        ? (data.document_output as { instructions: string }).instructions
        : undefined,
    documentBundleId:
      typeof data.document_bundle_id === 'string'
        ? data.document_bundle_id
        : typeof (data.document_bundle as { id?: unknown })?.id === 'string'
          ? (data.document_bundle as { id: string }).id
          : undefined,
    htmlSource:
      typeof data.html_source === 'string' && isPreviewPath(data.html_source)
        ? data.html_source
        : undefined,
    assetVersion,
    modifiedAt: stat.mtimeMs,
  };
};
