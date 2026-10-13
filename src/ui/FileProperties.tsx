import { useEffect, useState } from 'react';
import { DocumentStatusBadge } from './DocumentStatusBadge';
import { workflowId, type DocumentStatuses } from '../document-statuses';
import type { FileAuthorship } from '../shared';
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
export function FilePropertyBadges({
  document: doc,
  relativePath,
  authorshipKey,
  visibility,
  statuses,
  disabled,
  reason,
  change,
  manage,
  details,
}: {
  document: FilePropertyDocument;
  relativePath: string;
  authorshipKey: string;
  visibility: FilePropertyVisibility;
  statuses: DocumentStatuses;
  disabled: boolean;
  reason?: string;
  change: (id: string) => void;
  manage: () => void;
  details: () => void;
}) {
  const [authorship, setAuthorship] = useState<FileAuthorship>();
  const system = filePropertyDefinitions.filter(
    (p) => p.id !== 'status' && propertyVisible(visibility, p.id),
  );
  const wantsAuthorship = system.length > 0;
  useEffect(() => {
    let live = true;
    setAuthorship(undefined);
    if (wantsAuthorship)
      void window.gameCanvas
        .getFileAuthorship(relativePath)
        .then((a) => {
          if (live) setAuthorship(a);
        })
        .catch(() => {
          if (live) setAuthorship({});
        });
    return () => {
      live = false;
    };
  }, [relativePath, authorshipKey, wantsAuthorship]);
  const showStatus =
    statusPropertyApplied(doc) && propertyVisible(visibility, 'status');
  const visibleSystem = system.slice(0, showStatus ? 1 : 2);
  if (!showStatus && !system.length) return null;
  return (
    <div
      className="file-property-badges nodrag nowheel"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {showStatus && (
        <DocumentStatusBadge
          document={doc}
          statuses={statuses}
          disabled={disabled}
          reason={reason}
          change={change}
          manage={manage}
        />
      )}
      {visibleSystem.map((p) => (
        <button
          key={p.id}
          className="file-property-badge"
          title={`${p.name}: ${recordedValue(authorship, p.id as Exclude<FilePropertyId, 'status'>)}`}
          onClick={details}
        >
          <span>{p.name}</span>
          <strong>
            {authorship
              ? recordedValue(
                  authorship,
                  p.id as Exclude<FilePropertyId, 'status'>,
                )
              : '불러오는 중…'}
          </strong>
        </button>
      ))}
      {system.length > visibleSystem.length && (
        <button
          className="file-property-more"
          title="표시한 속성 모두 보기"
          onClick={details}
        >
          +{system.length - visibleSystem.length}
        </button>
      )}
    </div>
  );
}
export function FilePropertiesEditor({
  document: doc,
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
        <small>우측 상단 표시는 내 화면에만 적용됩니다.</small>
      </header>
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
            !statuses.statuses.some((s) => s.id === doc.workflowStatusId) && (
              <option value={doc.workflowStatusId}>이전 상태 (삭제됨)</option>
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
        <p>상태를 적용하면 칸반에 포함됩니다. 해제해도 이전 값은 보존됩니다.</p>
      )}
      {filePropertyDefinitions
        .filter((p) => p.id !== 'status')
        .map((p) => (
          <div className="file-property-row" key={p.id}>
            <strong>{p.name}</strong>
            <span className="file-property-value" title="자동 기록 · 읽기 전용">
              {recordedValue(
                authorship,
                p.id as Exclude<FilePropertyId, 'status'>,
              )}
            </span>
            <label>
              <input
                type="checkbox"
                aria-label={`${p.name} 우측 상단 표시`}
                checked={propertyVisible(visibility, p.id)}
                onChange={(e) => display(p.id, e.target.checked)}
              />
              표시
            </label>
          </div>
        ))}
      <button disabled={disabled || busy} onClick={manage}>
        상태 옵션·색 관리
      </button>
      {reason && <p role="status">{reason}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
