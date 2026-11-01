/** Presentation is paused; stored colors and the existing command stay intact. */
export function CardColorUnavailable() {
  return (
    <div
      className="card-color-unavailable"
      role="group"
      aria-label="카드 색상 변경"
    >
      <button type="button" role="menuitem" disabled>
        색상 변경 (사용 중지)
      </button>
      <small>
        카드 표시 통일을 위해 중지했습니다. 기존 색상 설정은 보존됩니다.
      </small>
    </div>
  );
}
