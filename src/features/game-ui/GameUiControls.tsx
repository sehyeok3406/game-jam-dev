import { useState } from 'react';
import { PREVIEW_PRESETS } from '../../preview-window';
import { nearDocumentPosition } from '../../canvas-placement';
import type { GameUiFrame, GameUiCommand } from '../../game-ui-types';
export function GameUiControls({
  frames,
  canvasId,
  disabled,
  submit,
  focus,
  occupied,
}: {
  frames: GameUiFrame[];
  canvasId: string;
  disabled: boolean;
  submit: (c: GameUiCommand) => Promise<void>;
  focus: (id: string) => void;
  occupied: { x: number; y: number; width: number; height: number }[];
}) {
  const [preset, setPreset] = useState('pc-1080'),
    [name, setName] = useState('게임 화면'),
    [width, setWidth] = useState(1920),
    [height, setHeight] = useState(1080),
    [error, setError] = useState('');
  const create = async () => {
    const id = crypto.randomUUID(),
      generation = crypto.randomUUID();
    const location = nearDocumentPosition(
      { width: 1040, height: 42 + (720 * height) / width },
      occupied,
    );
    try {
      await submit({
        id,
        generation,
        action: 'create',
        frame: {
          version: 1,
          id,
          generation,
          canvasId,
          title: name.trim() || '게임 화면',
          x: location.x,
          y: location.y,
          width: 720,
          viewportWidth: width,
          viewportHeight: height,
          items: [],
          descriptionPath: null,
        },
      });
      focus(id);
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <div className="game-ui-controls" data-ui-id="game-ui-controls">
      <p>
        화면 틀을 추가한 뒤 <strong>UI 편집</strong>에서 체력·스킬·아이템 등을
        넣으세요. 설명 문서는 화면의 버튼으로 생성합니다.
      </p>
      <fieldset disabled={disabled}>
        <label>
          이름
          <input
            aria-label="새 게임 화면 이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
          />
        </label>
        <label>
          화면 비율
          <select
            aria-label="새 게임 화면 비율"
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value);
              const p = PREVIEW_PRESETS.find((p) => p.id === e.target.value);
              if (p) {
                setWidth(p.width);
                setHeight(p.height);
              }
            }}
          >
            {PREVIEW_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.device} {p.width}×{p.height} · {p.ratio}
              </option>
            ))}
            <option value="custom">사용자 지정</option>
          </select>
        </label>
        {preset === 'custom' && (
          <div className="game-ui-actions">
            <label>
              너비
              <input
                type="number"
                aria-label="새 화면 너비"
                min={64}
                max={8192}
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
              />
            </label>
            <label>
              높이
              <input
                type="number"
                aria-label="새 화면 높이"
                min={64}
                max={8192}
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
              />
            </label>
          </div>
        )}
        <button type="button" onClick={() => void create()}>
          게임 화면 틀 추가
        </button>
      </fieldset>
      {disabled && <p>편집 권한과 협업 서버의 게임 UI 지원을 확인해주세요.</p>}
      {error && <p role="alert">{error}</p>}
      <h4>현재 캔버스의 게임 화면</h4>
      {frames
        .filter((f) => f.canvasId === canvasId)
        .map((f) => (
          <button key={f.id} onClick={() => focus(f.id)}>
            {f.title} · UI {f.items.length}개
          </button>
        ))}
    </div>
  );
}
