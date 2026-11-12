import { useLayoutEffect, useRef, useState } from 'react';
import {
  fileNodeStyle,
  MAX_NODE_FONT_SIZE,
  MIN_NODE_BODY,
  MIN_NODE_FONT_SIZE,
  titleHeightFor,
  type FileNodeStyle,
} from '../../core/canvas/file-node-style';
import { FileNodeSurface, fileNodeVariables } from './FileNodeSurface';

const sample =
  '플레이어는 도시를 탐험하고 여러 단서를 모읍니다. 새로운 구역을 열면 이야기가 이어집니다.';
const dimensions = [
  { key: 'width', label: '기본 너비', min: 180, max: 1200 },
  { key: 'height', label: '전체 높이', min: 88, max: 600 },
  { key: 'radius', label: '모서리 둥글기', min: 0, max: 48 },
  { key: 'titleHeight', label: '제목 높이', min: 38, max: 550 },
] as const;
const fontDimensions = [
  { key: 'markdownTitleSize', label: 'MD 제목 글씨 크기' },
  { key: 'markdownBodySize', label: 'MD 본문 글씨 크기' },
  { key: 'htmlTitleSize', label: 'HTML 제목 글씨 크기' },
] as const;
const settingsDimensions = [
  ...dimensions,
  ...fontDimensions.map((field) => ({
    ...field,
    min: MIN_NODE_FONT_SIZE,
    max: MAX_NODE_FONT_SIZE,
  })),
];
const colors = [
  { key: 'markdownTitle', label: 'MD 제목 배경색', fallback: '#f4f6f8' },
  { key: 'markdownBody', label: 'MD 본문 배경색', fallback: '#ffffff' },
  { key: 'htmlTitle', label: 'HTML 제목 배경색', fallback: '#f4f6f8' },
] as const;

export function FileNodeSettings({
  value,
  canApply,
  save,
  applyAll,
  close,
}: {
  value: FileNodeStyle;
  canApply: boolean;
  save: (value: FileNodeStyle) => void;
  applyAll: () => void;
  close: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState(680);
  const [message, setMessage] = useState('');
  const [numericInput, setNumericInput] = useState<{
    key: keyof FileNodeStyle;
    value: string;
  }>();
  const sampleArea = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    closeButton.current?.focus();
    const area = sampleArea.current;
    if (!area) return;
    const resize = () => setWidth(area.clientWidth);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  const effective = fileNodeStyle(draft);
  const mdSize = expanded ? { width: 340, height: 300 } : effective;
  const htmlSize = expanded ? { width: 720, height: 520 } : effective;
  const displayWidth = mdSize.width + htmlSize.width + 20;
  const scale = Math.min(
    1,
    width / displayWidth,
    280 / Math.max(mdSize.height, htmlSize.height),
  );
  const title = titleHeightFor(mdSize.height, effective.titleHeight);
  const body = mdSize.height - title;
  const divisor = gcd(title, body);
  const change = (patch: Partial<FileNodeStyle>) => {
    setDraft((previous) => fileNodeStyle({ ...previous, ...patch }));
    setMessage('');
  };
  const run = (action: () => void, success: string) => {
    try {
      action();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div
      className="dialog-backdrop"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          close();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="노드 모양"
        className="section-dialog floating-surface file-node-settings"
      >
        <header>
          <h2>노드 모양</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="닫기"
            ref={closeButton}
            onClick={close}
          >
            ×
          </button>
        </header>
        <div className="file-node-settings__preview">
          <div className="file-node-settings__preview-controls">
            <button
              type="button"
              aria-pressed={!expanded}
              onClick={() => setExpanded(false)}
            >
              접힌 모습
            </button>
            <button
              type="button"
              aria-pressed={expanded}
              onClick={() => setExpanded(true)}
            >
              펼친 모습
            </button>
            <span>미리보기 {Math.round(scale * 100)}%</span>
          </div>
          <div
            ref={sampleArea}
            className="file-node-settings__sample"
            style={{ height: Math.max(mdSize.height, htmlSize.height) * scale }}
          >
            <div
              className="file-node-settings__cards"
              style={{ width: displayWidth, transform: `scale(${scale})` }}
            >
              {(
                [
                  ['md', '게임 개요', mdSize],
                  ['html', '탐험 프로토타입', htmlSize],
                ] as const
              ).map(([kind, name, size]) => (
                <div
                  key={kind}
                  style={{ width: size.width, height: size.height }}
                >
                  {expanded ? (
                    <div
                      className={`file-node-example file-node-example--${kind}`}
                      style={fileNodeVariables(effective, kind, size.height)}
                    >
                      <div className="file-node-title">
                        <strong>{name}</strong>
                        <small>{kind === 'md' ? 'MD' : 'HTML'}</small>
                      </div>
                      <div className="file-node-example__body">
                        {kind === 'md' ? sample : null}
                      </div>
                    </div>
                  ) : (
                    <FileNodeSurface
                      kind={kind}
                      title={name}
                      body={kind === 'md' ? sample : undefined}
                      display={{ size, style: effective }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
          <small>
            MD 제목 {title}px · 본문 {body}px · {title / divisor}:
            {body / divisor}
          </small>
        </div>
        <div className="file-node-settings__fields">
          {settingsDimensions.map(({ key, label, min, max }) => {
            const limit =
              key === 'titleHeight' ? effective.height - MIN_NODE_BODY : max;
            const current = effective[key] ?? 13;
            return (
              <label key={key} className="file-node-settings__number">
                <span>{label}</span>
                <input
                  aria-label={label}
                  type="range"
                  min={min}
                  max={limit}
                  value={current}
                  onChange={(event) =>
                    change({ [key]: event.target.valueAsNumber })
                  }
                />
                <input
                  aria-label={`${label} 숫자`}
                  type="number"
                  min={min}
                  max={limit}
                  value={
                    numericInput?.key === key ? numericInput.value : current
                  }
                  onBlur={() => setNumericInput(undefined)}
                  onChange={(event) => {
                    setNumericInput({ key, value: event.target.value });
                    if (Number.isFinite(event.target.valueAsNumber))
                      change({ [key]: event.target.valueAsNumber });
                  }}
                />
              </label>
            );
          })}
          <div className="file-node-settings__colors">
            {colors.map(({ key, label, fallback }) => (
              <div key={key}>
                <label>
                  {label}
                  <input
                    type="color"
                    value={effective[key] || fallback}
                    onChange={(event) => change({ [key]: event.target.value })}
                  />
                </label>
                <button
                  type="button"
                  aria-label={`${label} 테마 기본값`}
                  onClick={() => change({ [key]: '' })}
                >
                  테마 기본
                </button>
              </div>
            ))}
          </div>
        </div>
        <footer className="section-dialog__actions">
          <span role="status">{message}</span>
          <button
            type="button"
            disabled={
              !canApply || JSON.stringify(effective) !== JSON.stringify(value)
            }
            onClick={() =>
              run(applyAll, '현재 프로젝트의 모든 MD·HTML 크기에 적용했습니다.')
            }
          >
            전체 노드에 적용
          </button>
          <button
            type="button"
            className="button-primary"
            onClick={() =>
              run(() => save(effective), '노드 모양을 저장했습니다.')
            }
          >
            저장
          </button>
        </footer>
      </section>
    </div>
  );
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
