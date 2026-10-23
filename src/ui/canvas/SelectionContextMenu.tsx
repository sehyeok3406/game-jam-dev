import { Copy, ArrowRight, Minimize2, Trash2 } from 'lucide-react';
import { CARD_COLORS, cardColor } from '../../card-colors.ts';
import type { SelectionMenuTargets } from './selection-menu-plan.ts';

export function SelectionContextMenu({
  x,
  y,
  targets,
  locked,
  canMove,
  canCopy,
  onColor,
  onCopy,
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
  onColor(color: string): void;
  onCopy(): void;
  onMove(): void;
  onCollapse(): void;
  onDelete(): void;
}) {
  const colors = [...targets.documents, ...targets.previews];
  const current = new Set(
    colors.map((item) => cardColor(item.backgroundColor)),
  );
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
      {colors.length > 0 && (
        <div
          className="card-color-picker"
          role="group"
          aria-label={`선택 카드 ${colors.length}개 배경색`}
        >
          <span>배경색 · {colors.length}개</span>
          {CARD_COLORS.map((color) => (
            <button
              key={color.id}
              title={color.label}
              aria-label={`${color.label} 배경색`}
              aria-pressed={current.size === 1 && current.has(color.id)}
              data-card-color={color.id}
              disabled={locked}
              onClick={() => onColor(color.id)}
            />
          ))}
        </div>
      )}
      {colors.length > 0 && colors.length !== targets.count && (
        <small>배경색 제외 {targets.count - colors.length}개</small>
      )}
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
