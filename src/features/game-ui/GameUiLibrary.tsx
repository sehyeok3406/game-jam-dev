import { useState } from 'react';
import { GAME_UI_KINDS, type GameUiKind } from '../../contracts/game-ui-types';

const groups: { title: string; kinds: GameUiKind[] }[] = [
  { title: '자원 게이지', kinds: ['health', 'mana', 'stamina', 'experience'] },
  { title: '슬롯과 HUD', kinds: ['skills', 'items'] },
  { title: '기본 요소', kinds: ['button', 'panel', 'text', 'image'] },
];
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
  const [query, setQuery] = useState('');
  const matches = (kind: GameUiKind) =>
    GAME_UI_KINDS[kind]
      .join(' ')
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase());
  const count = groups.flatMap((g) => g.kinds).filter(matches).length;
  return (
    <section className="game-ui-library" aria-label="게임 UI 라이브러리">
      <h3>UI 추가</h3>
      <p>요소를 추가한 뒤 속성에서 모양과 내용을 편집합니다.</p>
      <label className="game-ui-library-search">
        요소 검색
        <input
          type="search"
          aria-label="UI 요소 검색"
          placeholder="이름·용도 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <p role="status">{count}개 요소</p>
      <fieldset disabled={disabled || !enabled}>
        {groups.map((group) => {
          const kinds = group.kinds.filter(matches);
          return (
            kinds.length > 0 && (
              <section
                className="game-ui-library-category"
                key={group.title}
                aria-label={group.title}
              >
                <h4>{group.title}</h4>
                <div className="game-ui-library-grid">
                  {kinds.map((kind) => {
                    const [label, description] = GAME_UI_KINDS[kind];
                    return (
                      <button
                        type="button"
                        key={kind}
                        data-game-ui-kind={kind}
                        aria-label={`UI 추가: ${label}`}
                        title={description}
                        onClick={() => add(kind)}
                      >
                        <span
                          className={`game-ui-library-preview game-ui-library-preview--${kind}`}
                          aria-hidden="true"
                        >
                          <i />
                          <i />
                          <i />
                        </span>
                        <span className="game-ui-library-caption">
                          <strong>{label}</strong>
                          <small>{description}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )
          );
        })}
        {!count && (
          <p>일치하는 요소가 없습니다. 다른 이름이나 용도로 검색해보세요.</p>
        )}
        <details className="game-ui-library-presets">
          <summary>HUD 조합 · 여러 요소를 한 번에 추가</summary>
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
        </details>
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
