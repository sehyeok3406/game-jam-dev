import type { LocationItem } from '../../contracts/location-links.ts';
import type { Snapshot } from '../../contracts/project.ts';
import { snapshotDocuments } from '../../collaboration-model.ts';
import { snapshotDrawings } from '../../drawing-model.ts';
import { managedPreviewPaths } from '../../preview-output.ts';
import { describePreview } from '../../html-source.ts';
import {
  locationAnchorIds,
  textLocationAnchorIds,
} from '../../core/projects/location-anchors.ts';

export function locationIndex(files: Snapshot): LocationItem[] {
  const documents = snapshotDocuments(files);
  return [
    ...documents
      .filter((doc) => !doc.htmlSource && doc.type !== 'ai-task')
      .map((doc) => ({
        target: {
          kind:
            doc.identitySource === 'path'
              ? ('file' as const)
              : ('document' as const),
          id: doc.identitySource === 'path' ? doc.relativePath : doc.id,
        },
        documentId: doc.id,
        relativePath: doc.relativePath,
        canvasId: doc.canvasId ?? 'default',
        blockIds: locationAnchorIds(doc.body),
      })),
    ...managedPreviewPaths(files)
      .filter((path) => Object.hasOwn(files, path))
      .map((path) => {
        const preview = describePreview(files, path);
        return {
          target: { kind: 'html' as const, id: preview.sourceId! },
          relativePath: path,
          previewIdentityPath: preview.identityPath,
          canvasId: preview.canvasId ?? 'default',
        };
      }),
    ...snapshotDrawings(files).map((item) => ({
      target: { kind: 'drawing' as const, id: item.id },
      canvasId: item.canvasId,
      ...(item.kind === 'text'
        ? { blockIds: textLocationAnchorIds(item.geometry.document) }
        : {}),
    })),
  ];
}
