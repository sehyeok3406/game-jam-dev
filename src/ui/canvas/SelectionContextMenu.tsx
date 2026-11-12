import {
  Copy,
  ArrowRight,
  Frame,
  Minimize2,
  Trash2,
  Link2,
} from 'lucide-react';
import { CardColorUnavailable } from './CardColorUnavailable';
import type { SelectionMenuTargets } from './selection-menu-plan.ts';

type EmptySectionAction = { open(): void; blockedReason?: string };

export function CreateEmptySectionMenuItem({
  open,
  blockedReason,
}: EmptySectionAction) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={!!blockedReason}
      onClick={open}
    >
      <Frame size={16} />
      <span>
        <strong>새 섹션 만들기</strong>
        <small>{blockedReason ?? '이 위치에 빈 섹션 만들기'}</small>
      </span>
    </button>
  );
}

export function SelectionContextMenu({
  x,
  y,
  targets,
  locked,
  canMove,
  canCopy,
  onCopy,
  emptySection,
  onCopyLocation,
  onMove,
  onCollapse,
  onDelete,
}: {
  x: number;
  y: number;
  targets: SelectionMenuTargets;
  locked: boolean;
  canMove: boolean;
  canCopy: boolean;
  onCopy(): void;
  emptySection?: EmptySectionAction;
  onCopyLocation?: () => void;
  onMove(): void;
  onCollapse(): void;
  onDelete(): void;
}) {
  const colors = [...targets.documents, ...targets.previews];
  const supported =
    targets.documents.length +
    targets.sections.length +
    targets.previews.length +
    targets.drawings.length;
  return (
    <div
      data-ui-id="selection-menu"
      className="canvas-context-menu document-context-menu floating-surface"
      role="menu"
      aria-label="선택 항목 메뉴"
      style={{
        left: Math.max(0, Math.min(x, window.innerWidth - 292)),
        top: Math.max(0, Math.min(y, window.innerHeight - 350)),
        maxHeight: 'calc(100vh - 16px)',
        overflowY: 'auto',
      }}
    >
      <div className="context-menu-title">{targets.count}개 선택됨</div>
      {emptySection && <CreateEmptySectionMenuItem {...emptySection} />}
      {onCopyLocation && (
        <button type="button" role="menuitem" onClick={onCopyLocation}>
          <Link2 size={16} />
          <span>
            <strong>위치 링크 복사</strong>
            <small>프로젝트 참여자에게 이 위치 공유</small>
          </span>
        </button>
      )}
      {colors.length > 0 && <CardColorUnavailable />}
      {canCopy && (
        <button
          type="button"
          role="menuitem"
          disabled={!supported}
          onClick={onCopy}
        >
          <Copy size={16} />
          <span>
            <strong>다른 프로젝트로 복사…</strong>
            <small>{supported}개 자료 · 원본 유지 · 관련 파일 포함</small>
          </span>
        </button>
      )}
      {supported < targets.count && (
        <small>
          프로젝트 도구 {targets.count - supported}개는 자료 작업에서
          제외됩니다.
        </small>
      )}
      <button
        type="button"
        role="menuitem"
        disabled={locked || !canMove || !supported}
        onClick={onMove}
      >
        <ArrowRight size={16} />
        <span>
          <strong>다른 캔버스로 이동</strong>
          <small>선택한 자료와 섹션 내부 파일 함께 이동</small>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={locked || !targets.collapse.length}
        onClick={onCollapse}
      >
        <Minimize2 size={16} />
        <span>
          <strong>최소화·펼치기</strong>
          <small>{targets.collapse.length}개 항목에 함께 적용</small>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="danger-menu-item"
        disabled={locked || !supported}
        onClick={onDelete}
      >
        <Trash2 size={16} />
        <span>
          <strong>선택 항목 삭제</strong>
          <small>대상 확인 후 함께 삭제</small>
        </span>
      </button>
    </div>
  );
}
