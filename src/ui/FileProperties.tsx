import { useState } from 'react';
import { DocumentStatusBadge } from './DocumentStatusBadge';
import { workflowId, type DocumentStatuses } from '../document-statuses';
import type { FileAuthorship, DocumentType } from '../contracts/documents';
import { TYPE_LABELS, statusLabel } from './documents/presentation';
import {
  filePropertyDefinitions,
  propertyVisible,
  statusPropertyApplied,
  type FilePropertyDocument,
  type FilePropertyId,
  type FilePropertyVisibility,
} from '../file-properties';
import './file-properties.css';

function recordedValue(
  authorship: FileAuthorship | undefined,
  id: Exclude<FilePropertyId, 'status'>,
) {
  const value = authorship?.[id];
  if (!value) return '기록 없음';
  return typeof value === 'number'
    ? new Date(value).toLocaleString('ko-KR')
    : value.name;
}
/** Keep the header focused on the name and the optional workflow state. */
export function FilePropertyBadges({
  document: doc,
  visibility,
  statuses,
  disabled,
  reason,
  change,
  manage,
}: {
  document: FilePropertyDocument;
  visibility: FilePropertyVisibility;
  statuses: DocumentStatuses;
  disabled: boolean;
  reason?: string;
  change: (id: string) => void;
  manage: () => void;
}) {
  if (!statusPropertyApplied(doc) || !propertyVisible(visibility, 'status'))
    return null;
  return (
    <div
      className="file-property-badges nodrag nowheel"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <DocumentStatusBadge
        document={doc}
        statuses={statuses}
        disabled={disabled}
        reason={reason}
        change={change}
        manage={manage}
      />
    </div>
  );
}
export function FilePropertiesEditor({
  document: doc,
  metadata,
  statuses,
  authorship,
  visibility,
  disabled,
  reason,
  change,
  display,
  manage,
}: {
  document: FilePropertyDocument;
  metadata: {
    type: DocumentType | 'html';
    phase?: string;
    modifiedAt?: number;
  };
  statuses: DocumentStatuses;
  authorship?: FileAuthorship;
  visibility: FilePropertyVisibility;
  disabled: boolean;
  reason?: string;
  change: (value: { enabled?: boolean; statusId?: string }) => Promise<void>;
  display: (id: FilePropertyId, visible: boolean) => void;
  manage: () => void;
}) {
  const applied = statusPropertyApplied(doc);
  const workflow = metadata.type !== 'ai-task';
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const update = async (value: { enabled?: boolean; statusId?: string }) => {
    setBusy(true);
    setError('');
    try {
      await change(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="file-properties-editor" aria-label="파일 속성">
      <header>
        <strong>속성</strong>
        <small>
          {workflow
            ? '상단의 상태 표시는 내 화면에만 적용됩니다.'
            : '작업 정보와 생성 기록입니다.'}
        </small>
      </header>
      <div className="file-property-row" data-property="type">
        <strong>문서 유형</strong>
        <span className="file-property-value">
          {metadata.type === 'html' ? 'HTML' : TYPE_LABELS[metadata.type]}
        </span>
      </div>
      {metadata.phase && (
        <div className="file-property-row" data-property="phase">
          <strong>{workflow ? '문서 단계' : '작업 상태'}</strong>
          <span className="file-property-value">
            {statusLabel(metadata.phase)}
          </span>
        </div>
      )}
      {workflow && (
        <>
          <div className="file-property-row file-property-row--status">
            <strong>상태</strong>
            <label>
              <input
                type="checkbox"
                aria-label="상태 속성 적용"
                checked={applied}
                disabled={disabled || busy}
                onChange={(e) => void update({ enabled: e.target.checked })}
              />
              적용
            </label>
            <select
              aria-label="파일 상태 속성 값"
              value={
                applied
                  ? workflowId(doc)
                  : (doc.workflowStatusId ?? statuses.defaultStatusId)
              }
              disabled={!applied || disabled || busy}
              onChange={(e) => void update({ statusId: e.target.value })}
            >
              {doc.workflowStatusId &&
                !statuses.statuses.some(
                  (s) => s.id === doc.workflowStatusId,
                ) && (
                  <option value={doc.workflowStatusId}>
                    이전 상태 (삭제됨)
                  </option>
                )}
              {statuses.statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <label>
              <input
                type="checkbox"
                aria-label="상태 우측 상단 표시"
                checked={applied && propertyVisible(visibility, 'status')}
                disabled={!applied}
                onChange={(e) => display('status', e.target.checked)}
              />
              표시
            </label>
          </div>
          {!applied && (
            <p>
              상태를 적용하면 칸반에 포함됩니다. 해제해도 이전 값은 보존됩니다.
            </p>
          )}
        </>
      )}
      {filePropertyDefinitions
        .filter((p) => p.id !== 'status')
        .map((p) => (
          <div className="file-property-row" key={p.id}>
            <strong>{p.name}</strong>
            <span className="file-property-value" title="자동 기록 · 읽기 전용">
              {recordedValue(
                { lastEditedAt: metadata.modifiedAt, ...authorship },
                p.id as Exclude<FilePropertyId, 'status'>,
              )}
            </span>
          </div>
        ))}
      {workflow && (
        <button disabled={disabled || busy} onClick={manage}>
          상태 옵션·색 관리
        </button>
      )}
      {reason && <p role="status">{reason}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
