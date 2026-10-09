import { useMemo, useState } from 'react';
import { Eye, Folder, Search, X } from 'lucide-react';
import {
  GAME_FEATURE_CATALOG,
  GAME_FEATURES,
  GAME_FEATURE_PRESETS,
  FEATURE_DETAILED_EXAMPLES,
  searchGameFeatures,
} from '../game-feature-catalog';

export function GameFeatureLibrary() {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'features' | 'presets'>('features');
  const [activeId, setActiveId] = useState(GAME_FEATURES[0].id);
  const matches = useMemo(() => searchGameFeatures(query), [query]);
  const matchIds = useMemo(
    () => new Set(matches.map((feature) => feature.id)),
    [matches],
  );
  const active = GAME_FEATURES.find((feature) => feature.id === activeId)!;
  const example = FEATURE_DETAILED_EXAMPLES[active.name];

  return (
    <div className="game-feature-library">
      <p className="gamejam-preview-notice">
        <Eye size={16} aria-hidden="true" />
        게임 제작에 활용할 기능들을 미리 살펴보세요. 현재 기능 선택은 HTML
        구현에 반영되지 않습니다.
      </p>
      <div
        className="game-feature-views"
        role="group"
        aria-label="라이브러리 보기 방식"
      >
        <button
          type="button"
          aria-pressed={view === 'features'}
          onClick={() => setView('features')}
        >
          기능별 폴더
        </button>
        <button
          type="button"
          aria-pressed={view === 'presets'}
          onClick={() => setView('presets')}
        >
          장르별 추천 조합
        </button>
        <small>
          {GAME_FEATURE_CATALOG.length}개 분류 · {GAME_FEATURES.length}개 기능
          예시
        </small>
      </div>
      {view === 'features' ? (
        <>
          <label className="game-feature-search" htmlFor="game-feature-search">
            <span className="sr-only">게임 기능 검색</span>
            <Search size={16} aria-hidden="true" />
            <input
              id="game-feature-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="기능 이름·설명·태그 검색 (예: FPS, 타격감, 추격)"
            />
            {query && (
              <button
                type="button"
                aria-label="기능 검색 지우기"
                onClick={() => setQuery('')}
              >
                <X size={14} />
              </button>
            )}
          </label>
          <p className="game-feature-count" role="status">
            {query.trim()
              ? `검색 결과 ${matches.length}개 · 상위 분류와 하위 기능을 함께 표시합니다.`
              : '폴더를 펼치고 기능 이름을 눌러 설명을 확인하세요.'}
          </p>
          <div className="game-feature-browser">
            <div className="game-feature-tree" aria-label="게임 기능 폴더">
              {!matches.length && (
                <div className="game-feature-empty">
                  <strong>찾는 기능이 없습니다.</strong>
                  <p>다른 이름이나 태그로 검색해보세요.</p>
                  <button type="button" onClick={() => setQuery('')}>
                    전체 기능 보기
                  </button>
                </div>
              )}
              {GAME_FEATURE_CATALOG.map((item) => {
                const groups = item.groups
                  .map((group) => ({
                    ...group,
                    features: group.features.filter((feature) =>
                      matchIds.has(feature.id),
                    ),
                  }))
                  .filter((group) => group.features.length);
                if (!groups.length) return null;
                return (
                  <details
                    key={`${query.trim() ? 'search' : 'browse'}-${item.id}`}
                    open={query.trim() ? true : undefined}
                    className="game-feature-category"
                  >
                    <summary>
                      <Folder size={15} aria-hidden="true" />
                      <span>{item.name}</span>
                      <small>
                        {groups.reduce(
                          (count, group) => count + group.features.length,
                          0,
                        )}
                      </small>
                    </summary>
                    {groups.map((group) => (
                      <details
                        key={group.id}
                        open={query.trim() ? true : undefined}
                        className="game-feature-group"
                      >
                        <summary>
                          <span>{group.name}</span>
                          <small>{group.features.length}</small>
                        </summary>
                        <ul>
                          {group.features.map((feature) => (
                            <li key={feature.id}>
                              <button
                                type="button"
                                aria-pressed={activeId === feature.id}
                                onClick={() => setActiveId(feature.id)}
                              >
                                <Eye size={13} aria-hidden="true" />
                                <span>{feature.name}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ))}
                  </details>
                );
              })}
            </div>
            <aside
              className="game-feature-detail"
              aria-label="기능 상세 설명"
              aria-live="polite"
            >
              <span className="game-feature-path">
                {active.category} / {active.group}
              </span>
              <h4>{active.name}</h4>
              <span className="gamejam-preview-badge">기능 예시</span>
              <p>{example?.description ?? active.description}</p>
              {example && (
                <>
                  <strong>설정 예시</strong>
                  <ul>
                    {example.settings.map((setting) => (
                      <li key={setting}>{setting}</li>
                    ))}
                  </ul>
                  <strong>필요한 기능</strong>
                  <ul>
                    {example.dependencies.map((dependency) => (
                      <li key={dependency}>{dependency}</li>
                    ))}
                  </ul>
                  <strong>확인 시나리오</strong>
                  <ul>
                    {example.checks.map((check) => (
                      <li key={check}>{check}</li>
                    ))}
                  </ul>
                </>
              )}
              <p>
                구현 코드와 실행 예제는 추후 제공 예정입니다. 지원 환경과 세부
                설정은 실제 모듈을 제공할 때 안내합니다.
              </p>
              <button type="button" disabled>
                HTML 구현에 적용 · 준비 중
              </button>
            </aside>
          </div>
        </>
      ) : (
        <div className="game-feature-presets">
          <p>
            여러 기능을 묶어 게임 구성을 시작하는 추천 예시입니다. 기능 이름을
            누르면 해당 기능을 살펴볼 수 있습니다.
          </p>
          {GAME_FEATURE_PRESETS.map((preset) => (
            <section key={preset.name}>
              <h4>{preset.name}</h4>
              <div>
                {preset.features.map((name) => (
                  <button
                    type="button"
                    key={name}
                    onClick={() => {
                      const feature = GAME_FEATURES.find(
                        (entry) => entry.name === name,
                      );
                      if (!feature) return;
                      setActiveId(feature.id);
                      setQuery(name);
                      setView('features');
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
