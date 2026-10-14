import { GAME_UI_KINDS, type GameUiKind } from '../../game-ui-types';
export function GameUiLibrary({
  disabled,
  enabled,
  add,
  preset,
}: {
  disabled: boolean;
  enabled: boolean;
  add: (kind: GameUiKind) => void;
  preset: (name: string) => void;
}) {
  return (
    <section className="game-ui-library" aria-label="게임 UI 라이브러리">
      <h3>UI 추가</h3>
      <p>요소를 선택하면 게임 화면에 추가합니다.</p>
      <fieldset disabled={disabled || !enabled}>
        <div className="game-ui-library-grid">
          {Object.entries(GAME_UI_KINDS).map(([key, [label, description]]) => (
            <button
              type="button"
              key={key}
              data-game-ui-kind={key}
              aria-label={`UI 추가: ${label}`}
              title={description}
              onClick={() => add(key as GameUiKind)}
            >
              <span
                className={`game-ui-library-preview game-ui-library-preview--${key}`}
                aria-hidden="true"
              >
                <i />
                <i />
                <i />
              </span>
              <strong>{label}</strong>
            </button>
          ))}
        </div>
        <label>
          HUD 조합
          <select
            aria-label="HUD 조합"
            value=""
            onChange={(e) => {
              if (e.target.value) preset(e.target.value);
            }}
          >
            <option value="">조합 선택…</option>
            <option value="resources">체력·마나·스태미나</option>
            <option value="portrait">초상화와 자원 게이지</option>
            <option value="skills">하단 스킬 HUD</option>
            <option value="inventory">5×4 인벤토리</option>
          </select>
        </label>
      </fieldset>
      {!enabled && (
        <p>
          플러그인을 켜면 새 UI를 추가할 수 있습니다. 기존 UI는 계속 편집할 수
          있습니다.
        </p>
      )}
      {disabled && <p>보기 권한에서는 UI를 추가할 수 없습니다.</p>}
    </section>
  );
}
