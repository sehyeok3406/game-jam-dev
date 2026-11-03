export type TaskInstructionKind = 'organize' | 'implement';
export type TaskInstructionTemplateId =
  | 'organize-markdown'
  | 'organize-html'
  | 'organize-html-compose'
  | 'implement';
/** Full-text replacement stays compatible with the existing editable request field. */
export type TaskInstructionOriginV1 = {
  version: 1;
  templateId: TaskInstructionTemplateId;
  templateVersion: number;
  defaultText: string;
  source: 'default' | 'custom' | 'legacy';
};
export type EffectiveInstructionsV2 = {
  version: 2;
  kind: TaskInstructionKind;
  templateId: TaskInstructionTemplateId;
  templateVersion: number;
  defaultText: string;
  defaultSha256: string;
  source: TaskInstructionOriginV1['source'];
  userText: string | null;
  effectiveText: string;
  effectiveSha256: string;
};
/** Frozen request context, separate from the execution/workflow format version. */
export type TaskDesignContextV1 = {
  version: 1;
  originalInputs: string[];
  originalInstructions: Partial<Record<TaskInstructionKind, string>>;
  designDocuments: string[];
};
/** Explicit writable design documents; their bytes are captured at run start. */
export type TaskDocumentUpdatesV1 = {
  version: 1;
  targets: { path: string; id: string }[];
};
