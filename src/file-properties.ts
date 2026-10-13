import type { WorkflowInput } from './document-statuses.ts';

export const FILE_PROPERTIES_VERSION = 1;
export const filePropertyDefinitions = [
  {
    id: 'status',
    name: '상태',
    type: 'status',
    editable: true,
    optional: true,
  },
  {
    id: 'createdBy',
    name: '생성자',
    type: 'person',
    editable: false,
    optional: false,
  },
  {
    id: 'createdAt',
    name: '생성일',
    type: 'date',
    editable: false,
    optional: false,
  },
  {
    id: 'lastEditedBy',
    name: '마지막 편집자',
    type: 'person',
    editable: false,
    optional: false,
  },
  {
    id: 'lastEditedAt',
    name: '편집일',
    type: 'date',
    editable: false,
    optional: false,
  },
] as const;
export type FilePropertyId = (typeof filePropertyDefinitions)[number]['id'];
export type FilePropertyDocument = {
  statusPropertyEnabled?: boolean;
  workflowStatusId?: string;
};
/** Missing flags belong to legacy files: preserve their previous status behavior. */
export const statusPropertyApplied = (doc: FilePropertyDocument) =>
  doc.statusPropertyEnabled !== false;
export type StatusPropertyInput = Omit<
  WorkflowInput,
  'statusId' | 'beforeId' | 'afterId'
> & {
  expectedEnabled: boolean;
  enabled?: boolean;
  statusId?: string;
};
export type FilePropertyVisibility = Partial<Record<FilePropertyId, boolean>>;
export type FilePropertyViews = {
  version: 1;
  files: Record<string, FilePropertyVisibility>;
};
export const emptyFilePropertyViews: FilePropertyViews = {
  version: 1,
  files: {},
};
export function propertyVisible(
  visibility: FilePropertyVisibility,
  id: FilePropertyId,
) {
  return visibility[id] ?? id === 'status';
}
/** Normalize personal preferences without accepting arbitrary property keys. */
export function readFilePropertyViews(raw: unknown): FilePropertyViews {
  const files = (raw as FilePropertyViews | null)?.files;
  if (!files || typeof files !== 'object' || Array.isArray(files))
    return emptyFilePropertyViews;
  return {
    version: 1,
    files: Object.fromEntries(
      Object.entries(files).flatMap(([key, value]) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          return [];
        return [
          [
            key,
            Object.fromEntries(
              filePropertyDefinitions.flatMap(({ id }) =>
                typeof value[id] === 'boolean' ? [[id, value[id]]] : [],
              ),
            ),
          ],
        ];
      }),
    ),
  };
}
