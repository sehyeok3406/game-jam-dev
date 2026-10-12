import type { CSSProperties } from 'react';
import {
  workflowId,
  statusForeground,
  type DocumentStatuses,
} from '../document-statuses';

export function DocumentStatusBadge({
  document,
  statuses,
  disabled,
  change,
  manage,
}: {
  document: { workflowStatusId?: string };
  statuses: DocumentStatuses;
  disabled: boolean;
  change: (id: string) => void;
  manage: () => void;
}) {
  const id = workflowId(document),
    status = statuses.statuses.find((s) => s.id === id);
  const color = status?.badgeColor ?? '#6B7280';
  return (
    <select
      className="workflow-badge nodrag nowheel"
      aria-label={`문서 상태: ${status?.name ?? '알 수 없는 상태'}`}
      title={status?.name ?? '알 수 없는 상태'}
      disabled={disabled}
      value={id}
      style={
        {
          '--workflow-color': color,
          color: statusForeground(color),
          backgroundColor: color,
        } as CSSProperties
      }
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        if (e.target.value === '__manage__') manage();
        else change(e.target.value);
      }}
    >
      {!status && <option value={id}>알 수 없는 상태</option>}
      {statuses.statuses.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
      <option value="__manage__">상태 관리…</option>
    </select>
  );
}
