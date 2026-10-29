import { useState, useSyncExternalStore } from 'react';
import type {
  GameUiItem,
  GameUiDetails,
  GameUiStyle,
  GameUiState,
} from '../../game-ui-types';
import {
  GAME_UI_STATES,
  GAME_UI_STYLE_KEYS,
  gameUiStyle,
  gameUiRatio,
  gameUiRangePatch,
  isGauge,
} from '../../game-ui-details';
import type { GameUiPreview } from './GameUiGraphic';
import { GAME_UI_SHAPES } from '../../game-ui-types';
import {
  GameUiNumberField as NumberField,
  GameUiColorField as ColorField,
  GameUiTextField,
  GameUiRangeFields,
} from './GameUiFields';
let styleClipboard: Partial<GameUiDetails> | null = null;
const clipboardListeners = new Set<() => void>();
const subscribeClipboard = (listener: () => void) => {
  clipboardListeners.add(listener);
  return () => {
    clipboardListeners.delete(listener);
  };
};
const readClipboard = () => styleClipboard;
const copyStyle = (style: Partial<GameUiDetails>) => {
  styleClipboard = structuredClone(style);
  clipboardListeners.forEach((listener) => listener());
};
export function GameUiDetailInspector({
  items,
  disabled,
  apply: submitChanges,
  editingState,
  setEditingState,
  draft,
  preview,
  setPreview,
  animate,
  stop,
}: {
  items: GameUiItem[];
  disabled: boolean;
  apply: (changes: Partial<GameUiItem>) => void | Promise<unknown>;
  editingState: GameUiState;
  setEditingState: (state: GameUiState) => void;
  draft: (changes: Partial<GameUiItem>) => void;
  preview?: GameUiPreview;
  setPreview: (v: GameUiPreview | undefined) => void;
  animate: (value: number) => void;
  stop: () => void;
}) {
  const [feedback, setFeedback] = useState(''),
    copied = useSyncExternalStore(
      subscribeClipboard,
      readClipboard,
      readClipboard,
    );
  const one = items.length === 1 ? items[0] : null,
    first = items[0],
    gauge = !!one && isGauge(one);
  const activeState = one ? editingState : 'normal';
  const apply = (changes: Partial<GameUiItem>) => {
    const result = submitChanges(changes);
    void Promise.resolve(result).catch(() => {});
    return result;
  };
  const fills = items.every(isGauge);
  const source = (key: keyof GameUiStyle) =>
    activeState === 'normal'
      ? undefined
      : Object.hasOwn(first.stateStyles?.[activeState] ?? {}, key)
        ? '별도 설정'
        : '기본에서 상속';
  const shape = items.every((i) => i.shape === first.shape) ? first.shape : '';
  const stateNote =
    activeState === 'normal'
      ? '기본 외형을 편집합니다.'
      : GAME_UI_STATES[activeState] +
        ' 외형을 편집합니다. 상속 항목을 수정하면 이 상태에만 적용됩니다.';
  const rule = one?.thresholds?.find(
    (t) => gameUiRatio(one, preview?.value ?? one.value) * 100 <= t.below,
  );

  const styles = items.map((i) => gameUiStyle(i, activeState));
  const mixed = <K extends keyof GameUiStyle>(k: K): GameUiStyle[K] | '' =>
    styles.every((s) => JSON.stringify(s[k]) === JSON.stringify(styles[0][k]))
      ? styles[0][k]
      : '';
  const changeStyle = (change: Partial<GameUiStyle>, temporary = false) => {
    if (change.cornerRadius !== undefined && change.cornerRadii === undefined)
      change.cornerRadii = null;
    const patch =
      activeState === 'normal'
        ? change
        : {
            stateStyles: {
              ...first.stateStyles,
              [activeState]: { ...first.stateStyles?.[activeState], ...change },
            },
          };
    if (
      (change.cornerRadius !== undefined || change.cornerRadii !== undefined) &&
      items.every((i) => ['rectangle', 'rounded'].includes(i.shape))
    )
      Object.assign(patch, { shape: 'rounded' });
    return (temporary ? draft : apply)(patch);
  };
  const choice = (
    label: string,
    value: string,
    options: Record<string, string>,
    fn: (v: string) => void,
  ) => (
    <label>
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => fn(e.target.value)}
      >
        {value === '' && <option value="">혼합</option>}
        {Object.entries(options).map(([k, l]) => (
          <option value={k} key={k}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
  const styleNumber = (
    label: string,
    k: keyof GameUiStyle,
    min = 0,
    max = 4096,
    percent = false,
  ) => {
    const v = mixed(k);
    return (
      <div
        key={activeState + ':' + k}
        className="game-ui-style-property"
        data-source={source(k)}
      >
        <NumberField
          label={label}
          value={
            typeof v === 'number'
              ? percent
                ? Number((v * 100).toFixed(2))
                : v
              : ''
          }
          min={min}
          max={max}
          unit={
            percent
              ? '%'
              : k === 'fontSize' || k === 'cornerRadius' || k === 'borderWidth'
                ? 'px'
                : undefined
          }
          apply={(n) => changeStyle({ [k]: percent ? n / 100 : n })}
          preview={(n) => changeStyle({ [k]: percent ? n / 100 : n }, true)}
          cancel={() => draft({})}
        />
        {source(k) && (
          <small className="game-ui-state-source">{source(k)}</small>
        )}
      </div>
    );
  };
  const styleColor = (
    label: string,
    k: 'backgroundColor' | 'borderColor' | 'fillColor' | 'textColor',
  ) => {
    const alpha = (
      {
        backgroundColor: 'backgroundOpacity',
        borderColor: 'borderOpacity',
        fillColor: 'fillOpacity',
        textColor: 'textOpacity',
      } as const
    )[k];
    const v = mixed(alpha);
    return (
      <div
        key={activeState + ':' + k}
        className="game-ui-style-property"
        data-source={source(k)}
      >
        <ColorField
          label={label}
          value={mixed(k)}
          apply={(v) =>
            changeStyle({
              [k]: v,
              ...(k === 'backgroundColor' &&
              styles.every((s) => s.backgroundOpacity === 0)
                ? { backgroundOpacity: 1 }
                : {}),
            })
          }
          preview={(v) =>
            changeStyle(
              {
                [k]: v,
                ...(k === 'backgroundColor' &&
                styles.every((s) => s.backgroundOpacity === 0)
                  ? { backgroundOpacity: 1 }
                  : {}),
              },
              true,
            )
          }
          cancel={() => draft({})}
          opacity={typeof v === 'number' ? Number((v * 100).toFixed(2)) : ''}
          applyOpacity={(n) => changeStyle({ [alpha]: n / 100 })}
          previewOpacity={(n) => changeStyle({ [alpha]: n / 100 }, true)}
        />
        {source(k) && (
          <small className="game-ui-state-source">
            색: {source(k)} · 불투명도: {source(alpha)}
          </small>
        )}
      </div>
    );
  };
  const valueNumber = (
    label: string,
    k: keyof GameUiDetails,
    value: number,
    min = 0,
    max = 4096,
  ) => (
    <NumberField
      label={label}
      value={value}
      min={min}
      max={max}
      integer={k === 'decimals' || k === 'segments'}
      apply={(n) => apply({ [k]: k === 'cooldownOpacity' ? n / 100 : n })}
    />
  );
  return (
    <div
      className="game-ui-detail-editor"
      data-ui-id="game-ui-detail-editor"
      onBlurCapture={() => draft({})}
    >
      <fieldset disabled={disabled}>
        <section className="game-ui-section game-ui-rotation">
          <h3>회전</h3>
          <NumberField
            label="UI 회전 (°)"
            displayLabel="회전"
            value={
              items.every((i) => (i.rotation ?? 0) === (first.rotation ?? 0))
                ? (first.rotation ?? 0)
                : ''
            }
            unit="°"
            cancel={() => draft({})}
            min={-360}
            max={360}
            apply={(rotation) => apply({ rotation })}
            preview={(rotation) => draft({ rotation })}
          />
          <button type="button" onClick={() => apply({ rotation: 0 })}>
            회전 초기화
          </button>
        </section>
        <div className="game-ui-state-editor">
          {' '}
          {one &&
            choice('외형 편집 상태', editingState, GAME_UI_STATES, (v) => {
              setEditingState(v as GameUiState);
              setPreview({ ...preview, state: v as GameUiState });
            })}
          {activeState !== 'normal' && <p>{stateNote}</p>}
        </div>
        <details open className="game-ui-appearance">
          <summary>외형</summary>
          {choice(
            'UI 외형',
            shape,
            Object.fromEntries(
              Object.entries(GAME_UI_SHAPES).filter(
                ([key]) => key !== 'ring' || fills,
              ),
            ),
            (v) => apply({ shape: v as GameUiItem['shape'] }),
          )}
          <p className="game-ui-help">
            불투명도 0%는 숨김, 100%는 완전히 보입니다.
          </p>
          {styleColor('배경색', 'backgroundColor')}
          <label>
            <input
              type="checkbox"
              aria-label="테두리 표시"
              checked={styles.every(
                (s) => s.borderWidth > 0 && s.borderOpacity > 0,
              )}
              ref={(input) => {
                if (input)
                  input.indeterminate =
                    styles.some(
                      (s) => s.borderWidth > 0 && s.borderOpacity > 0,
                    ) &&
                    !styles.every(
                      (s) => s.borderWidth > 0 && s.borderOpacity > 0,
                    );
              }}
              onChange={(e) =>
                changeStyle(
                  e.target.checked
                    ? {
                        borderOpacity: 1,
                        ...(styles.some((s) => s.borderWidth === 0)
                          ? { borderWidth: 2 }
                          : {}),
                      }
                    : { borderOpacity: 0 },
                )
              }
            />
            테두리 표시
          </label>
          {styleColor('테두리 색', 'borderColor')}
          {styleNumber('테두리 두께', 'borderWidth', 0, 128)}
          {items.every((i) => ['rectangle', 'rounded'].includes(i.shape)) && (
            <>
              {styleNumber('모서리 R값', 'cornerRadius')}
              <button
                type="button"
                onClick={() => {
                  changeStyle({
                    cornerRadii: styles[0].cornerRadii
                      ? null
                      : [
                          styles[0].cornerRadius,
                          styles[0].cornerRadius,
                          styles[0].cornerRadius,
                          styles[0].cornerRadius,
                        ],
                  });
                }}
              >
                {styles[0].cornerRadii ? '모서리 연결' : '모서리별 R값'}
              </button>
              {styles[0].cornerRadii &&
                ['왼쪽 위', '오른쪽 위', '오른쪽 아래', '왼쪽 아래'].map(
                  (l, n) => (
                    <NumberField
                      key={l}
                      label={`${l} R값`}
                      value={styles[0].cornerRadii![n]}
                      apply={(v) => {
                        const r = [...styles[0].cornerRadii!] as [
                          number,
                          number,
                          number,
                          number,
                        ];
                        r[n] = v;
                        changeStyle({ cornerRadii: r });
                      }}
                    />
                  ),
                )}
            </>
          )}
          {fills && !one && styleColor('채움색', 'fillColor')}
          <details className="game-ui-advanced">
            <summary>테두리 위치·점선</summary>{' '}
            {choice(
              '테두리 형태',
              mixed('borderStyle'),
              { solid: '실선', dashed: '파선', dotted: '점선' },
              (v) =>
                changeStyle({ borderStyle: v as GameUiStyle['borderStyle'] }),
            )}
            {choice(
              '테두리 위치',
              mixed('borderPosition'),
              { inside: '안쪽', center: '중앙', outside: '바깥쪽' },
              (v) =>
                changeStyle({
                  borderPosition: v as GameUiStyle['borderPosition'],
                }),
            )}
          </details>
          {styleNumber('전체 불투명도 (%)', 'opacity', 0, 100, true)}
          <p className="game-ui-help">
            전체 불투명도는 배경·테두리·문자에 함께 적용됩니다.
          </p>
          <div className="game-ui-actions">
            <button
              type="button"
              onClick={() =>
                copyStyle({
                  ...Object.fromEntries(
                    GAME_UI_STYLE_KEYS.map((k) => [k, gameUiStyle(first)[k]]),
                  ),
                  stateStyles: first.stateStyles,
                })
              }
            >
              스타일 복사
            </button>
            <button
              type="button"
              disabled={!copied}
              onClick={() => copied && apply(copied)}
            >
              스타일 붙여넣기
            </button>
          </div>
          {activeState !== 'normal' && (
            <button
              type="button"
              onClick={() => {
                const styles = { ...first.stateStyles };
                delete styles[activeState];
                apply({ stateStyles: styles });
              }}
            >
              이 상태 외형 초기화
            </button>
          )}
        </details>
        <details open={one?.kind === 'text'} className="game-ui-text-settings">
          <summary>문자</summary>
          {one && (
            <GameUiTextField
              label="UI 문구"
              value={one.text}
              apply={(text) => apply({ text })}
            />
          )}
          {styleColor('문자색', 'textColor')}
          {styleNumber('글자 크기', 'fontSize', 1, 512)}
          {choice(
            '문자 정렬',
            mixed('textAlign'),
            { left: '왼쪽', center: '가운데', right: '오른쪽' },
            (v) => changeStyle({ textAlign: v as GameUiStyle['textAlign'] }),
          )}
          <label>
            문자 표시
            <input
              aria-label="문자 표시"
              type="checkbox"
              checked={mixed('textVisible') === true}
              onChange={(e) => changeStyle({ textVisible: e.target.checked })}
            />
          </label>
        </details>
        {gauge && one && (
          <>
            <details open>
              <summary>값과 채움</summary>
              <GameUiRangeFields
                minimum={one.minimum ?? 0}
                maximum={one.maximum}
                current={one.value}
                apply={(range) => apply(gameUiRangePatch(one, range))}
                notify={setFeedback}
              />
              {feedback && (
                <p className="game-ui-help" role="status">
                  {feedback}
                </p>
              )}
              <div className="game-ui-field-grid">
                <NumberField
                  label="현재 값"
                  value={one.value}
                  min={one.minimum ?? 0}
                  max={one.maximum}
                  apply={(value) => apply({ value })}
                />
                <div className="game-ui-field">
                  <span>저장된 채움 비율</span>
                  <output>{Math.round(gameUiRatio(one) * 100)}%</output>
                </div>
              </div>
              {styleColor('채움색', 'fillColor')}
              {rule && (
                <p className="game-ui-rule-note" role="status">
                  현재 표시: {rule.below}% 이하 경고색 {rule.color}. 기본
                  채움색보다 우선합니다.
                </p>
              )}
              <details className="game-ui-advanced">
                <summary>채움 방향·표시 형식·구간</summary>
                {valueNumber(
                  '값 변화 단위',
                  'step',
                  one.step ?? 1,
                  0.000001,
                  1e9,
                )}
                {valueNumber(
                  '소수 자릿수',
                  'decimals',
                  one.decimals ?? 0,
                  0,
                  6,
                )}
                {choice(
                  '값 표시',
                  one.valueFormat ?? 'fraction',
                  {
                    fraction: '현재/최대',
                    value: '현재 값',
                    percent: '백분율',
                    none: '문구만',
                  },
                  (v) =>
                    apply({ valueFormat: v as GameUiDetails['valueFormat'] }),
                )}
                {choice(
                  '채움 방향',
                  one.fillDirection ??
                    (one.shape === 'circle' || one.shape === 'triangle'
                      ? 'up'
                      : 'right'),
                  {
                    right: '왼쪽 → 오른쪽',
                    left: '오른쪽 → 왼쪽',
                    up: '아래 → 위',
                    down: '위 → 아래',
                    'center-x': '중앙 → 좌우',
                    'center-y': '중앙 → 위아래',
                    radial: '원형',
                  },
                  (v) =>
                    apply({
                      fillDirection: v as GameUiDetails['fillDirection'],
                    }),
                )}
                {(one.shape === 'ring' || one.fillDirection === 'radial') && (
                  <>
                    {valueNumber(
                      '원형 시작 각도 (°)',
                      'radialStart',
                      one.radialStart ?? -90,
                      -360,
                      360,
                    )}
                    {valueNumber(
                      '원형 전체 각도 (°)',
                      'radialSweep',
                      one.radialSweep ?? 360,
                      1,
                      360,
                    )}
                    {one.shape === 'ring' &&
                      valueNumber(
                        '링 두께',
                        'ringWidth',
                        one.ringWidth ?? 10,
                        1,
                        256,
                      )}
                    <label>
                      시계 방향
                      <input
                        aria-label="시계 방향"
                        type="checkbox"
                        checked={one.clockwise !== false}
                        onChange={(e) => apply({ clockwise: e.target.checked })}
                      />
                    </label>
                  </>
                )}
                {valueNumber(
                  '게이지 구간 수',
                  'segments',
                  one.segments ?? 1,
                  1,
                  100,
                )}
                {valueNumber(
                  '구간 간격',
                  'segmentGap',
                  one.segmentGap ?? 2,
                  0,
                  100,
                )}
                <label>
                  칸 단위 채움
                  <input
                    aria-label="칸 단위 채움"
                    type="checkbox"
                    checked={!!one.segmentSnap}
                    onChange={(e) => apply({ segmentSnap: e.target.checked })}
                  />
                </label>
              </details>
            </details>
            <details>
              <summary>값에 따른 색 변경</summary>
              <button
                type="button"
                onClick={() =>
                  apply({
                    thresholds: one.thresholds?.length
                      ? []
                      : [
                          { below: 20, color: '#ef4444' },
                          { below: 50, color: '#eab308' },
                        ],
                  })
                }
              >
                {one.thresholds?.length ? '색 규칙 해제' : '낮은 값 경고 추가'}
              </button>
              <p>
                임계값 이하일 때 적용합니다. 더 낮은 구간을 먼저 확인합니다.
              </p>
              <button
                type="button"
                disabled={
                  (one.thresholds?.length ?? 0) >= 8 ||
                  (one.thresholds?.at(-1)?.below ?? 0) >= 100
                }
                onClick={() =>
                  apply({
                    thresholds: [
                      ...(one.thresholds ?? []),
                      {
                        below: Math.min(
                          100,
                          (one.thresholds?.at(-1)?.below ?? 0) + 20,
                        ),
                        color: gameUiStyle(one).fillColor,
                      },
                    ],
                  })
                }
              >
                색 규칙 추가
              </button>
              {one.thresholds?.map((t, n) => (
                <div key={n}>
                  <button
                    type="button"
                    onClick={() =>
                      apply({
                        thresholds: one.thresholds!.filter((_, j) => j !== n),
                      })
                    }
                  >
                    색 규칙 {n + 1} 삭제
                  </button>
                  <NumberField
                    label={`색 규칙 ${n + 1} 이하 (%)`}
                    value={t.below}
                    min={n ? one.thresholds![n - 1].below + 0.01 : 0}
                    max={
                      n + 1 < one.thresholds!.length
                        ? one.thresholds![n + 1].below - 0.01
                        : 100
                    }
                    apply={(v) =>
                      apply({
                        thresholds: one.thresholds!.map((x, j) =>
                          j === n ? { ...x, below: v } : x,
                        ),
                      })
                    }
                  />
                  <ColorField
                    label={`색 규칙 ${n + 1} 색`}
                    value={t.color}
                    apply={(v) =>
                      apply({
                        thresholds: one.thresholds!.map((x, j) =>
                          j === n ? { ...x, color: v } : x,
                        ),
                      })
                    }
                  />
                </div>
              ))}
            </details>
            <details>
              <summary>값 변화 효과</summary>
              {valueNumber(
                '전환 시간 (ms)',
                'transitionDuration',
                one.transitionDuration ?? 0,
                0,
                5000,
              )}
              {valueNumber(
                '잔상 시간 (ms)',
                'deltaDuration',
                one.deltaDuration ?? 0,
                0,
                5000,
              )}
              <ColorField
                label="잔상 색"
                value={one.deltaColor ?? '#facc15'}
                apply={(v) => apply({ deltaColor: v })}
              />
            </details>
          </>
        )}
        {one && ['skills', 'items', 'button'].includes(one.kind) && (
          <details open>
            <summary>상태 설정</summary>
            {choice('저장 상태', one.state ?? 'normal', GAME_UI_STATES, (v) =>
              apply({ state: v as GameUiState }),
            )}
            {one.kind === 'skills' && (
              <>
                {choice(
                  '쿨다운 채움',
                  one.cooldownDirection ?? 'down',
                  { down: '위에서 아래', radial: '원형 덮개' },
                  (v) =>
                    apply({
                      cooldownDirection:
                        v as GameUiDetails['cooldownDirection'],
                    }),
                )}
                <ColorField
                  label="쿨다운 색"
                  value={one.cooldownColor ?? '#475569'}
                  apply={(v) => apply({ cooldownColor: v })}
                />
                {valueNumber(
                  '쿨다운 불투명도 (%)',
                  'cooldownOpacity',
                  (one.cooldownOpacity ?? 0.55) * 100,
                  0,
                  100,
                )}
                <label>
                  쿨다운 숫자 표시
                  <input
                    aria-label="쿨다운 숫자 표시"
                    type="checkbox"
                    checked={!!one.cooldownText}
                    onChange={(e) => apply({ cooldownText: e.target.checked })}
                  />
                </label>
              </>
            )}
          </details>
        )}
      </fieldset>
      {one && (
        <details open className="game-ui-preview-controls">
          <summary>값·상태 테스트 · 저장되지 않음</summary>
          <p className="game-ui-help">
            {gauge
              ? `저장 값 ${one.value} / 테스트 값 ${preview?.value ?? one.value}`
              : `저장 상태 ${GAME_UI_STATES[one.state ?? 'normal']} / 표시 상태 ${GAME_UI_STATES[preview?.state ?? one.state ?? 'normal']}`}
          </p>
          {gauge && (
            <>
              <NumberField
                label="테스트 값 직접 입력"
                value={preview?.value ?? one.value}
                min={one.minimum ?? 0}
                max={one.maximum}
                apply={(value) => {
                  stop();
                  setPreview({ ...preview, value, delta: undefined });
                }}
              />
              <label>
                미리보기 값
                <input
                  aria-label="미리보기 값"
                  type="range"
                  min={one.minimum ?? 0}
                  max={one.maximum}
                  step={one.step ?? 1}
                  value={preview?.value ?? one.value}
                  onChange={(e) => {
                    stop();
                    setPreview({
                      ...preview,
                      value: Number(e.target.value),
                      delta: undefined,
                    });
                  }}
                />
              </label>
              <output>
                {preview?.value ?? one.value} (
                {Math.round(
                  gameUiRatio(one, preview?.value ?? one.value) * 100,
                )}
                %)
              </output>
              <div className="game-ui-actions">
                {[0, 25, 50, 75, 100].map((p) => (
                  <button
                    type="button"
                    key={p}
                    onClick={() =>
                      animate(
                        (one.minimum ?? 0) +
                          ((one.maximum - (one.minimum ?? 0)) * p) / 100,
                      )
                    }
                  >
                    {p}%
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    animate(
                      Math.max(
                        one.minimum ?? 0,
                        (preview?.value ?? one.value) -
                          (one.maximum - (one.minimum ?? 0)) * 0.2,
                      ),
                    )
                  }
                >
                  피해 20%
                </button>
                <button
                  type="button"
                  onClick={() =>
                    animate(
                      Math.min(
                        one.maximum,
                        (preview?.value ?? one.value) +
                          (one.maximum - (one.minimum ?? 0)) * 0.2,
                      ),
                    )
                  }
                >
                  회복 20%
                </button>
              </div>
            </>
          )}
          {choice(
            '미리보기 상태',
            preview?.state ?? one.state ?? 'normal',
            GAME_UI_STATES,
            (v) => setPreview({ ...preview, state: v as GameUiState }),
          )}
          {one.kind === 'skills' && (
            <label>
              쿨다운 미리보기 (%)
              <input
                type="range"
                aria-label="쿨다운 미리보기 (%)"
                min={0}
                max={100}
                value={preview?.cooldown ?? 0}
                onChange={(e) =>
                  setPreview({ ...preview, cooldown: Number(e.target.value) })
                }
              />
            </label>
          )}
          <div className="game-ui-actions">
            <button
              type="button"
              onClick={() => {
                stop();
                setPreview(undefined);
              }}
            >
              미리보기 초기화
            </button>
            <button type="button" onClick={stop}>
              재생 정지
            </button>
            {gauge && (
              <button
                type="button"
                disabled={disabled || preview?.value === undefined}
                onClick={() => {
                  apply({
                    value: gameUiRangePatch(one, { value: preview?.value })
                      .value,
                  });
                  setPreview(undefined);
                }}
              >
                현재 값에 적용
              </button>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
