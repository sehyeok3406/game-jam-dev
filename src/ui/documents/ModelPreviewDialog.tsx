import {
  Box,
  Grid3X3,
  Move,
  Pause,
  Play,
  Repeat2,
  RotateCcw,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ModelAsset } from '../../contracts/documents';
import { useRuntime } from '../runtime/RuntimeProvider';
import type { ModelViewer } from './model-viewer';

export function ModelPreviewDialog({
  asset,
  title,
  format,
  close,
  onSummary,
}: {
  asset: ModelAsset;
  title: string;
  format: 'glb' | 'fbx' | 'obj';
  close(): void;
  onSummary(summary: { clips: number; thumbnail: string }): void;
}) {
  const { api } = useRuntime();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<ModelViewer>(null);
  const [details, setDetails] =
    useState<Pick<ModelViewer, 'clips' | 'missingTextures' | 'skeletonOnly'>>();
  const [frame, setFrame] = useState({ time: 0, playing: false });
  const [clip, setClip] = useState(0);
  const [grid, setGrid] = useState(true);
  const [pan, setPan] = useState(false);
  const [repeat, setRepeat] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    const viewport = host.current;
    if (!viewport) return;
    const abort = new AbortController();
    const { signal } = abort;
    void Promise.all([
      api.editor.readAsset(asset.path),
      import('./model-viewer'),
    ])
      .then(async ([url, { startModelViewer }]) => {
        signal.throwIfAborted();
        const loaded = await startModelViewer(
          viewport,
          url,
          format,
          signal,
          (time, playing) => {
            if (!signal.aborted) setFrame({ time, playing });
          },
          (message) => {
            if (!signal.aborted) setError(message);
          },
        );
        if (signal.aborted) {
          loaded.dispose();
          return;
        }
        player.current = loaded;
        setDetails(loaded);
        onSummary({ clips: loaded.clips.length, thumbnail: loaded.thumbnail });
      })
      .catch((error: unknown) => {
        if (!signal.aborted)
          setError(
            error instanceof Error
              ? error.message.replace(/^.*?Error: /, '')
              : '3D 모델을 읽을 수 없습니다.',
          );
      });
    return () => {
      abort.abort();
      player.current?.dispose();
      player.current = null;
    };
  }, [api, asset.path, format, attempt, onSummary]);
  const current = details?.clips[clip];
  const ready = !!details && !error;
  const retry = () => {
    setDetails(undefined);
    setFrame({ time: 0, playing: false });
    setClip(0);
    setGrid(true);
    setPan(false);
    setRepeat(true);
    setError('');
    setAttempt((previous) => previous + 1);
  };

  return createPortal(
    <dialog
      ref={dialog}
      className="model-viewer"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <header className="model-viewer__header">
        <Box size={21} />
        <h2 id={id} title={title}>
          {title}
        </h2>
        <span className="model-format">{format.toUpperCase()}</span>
        <button
          type="button"
          autoFocus
          aria-label="뷰어 닫기"
          title="뷰어 닫기"
          onClick={close}
        >
          <X size={20} />
        </button>
      </header>
      <div className="model-viewer__stage">
        <div
          className="model-viewer__viewport"
          data-pan={pan || undefined}
          ref={host}
          role="region"
          aria-label="3D 모델 조작 영역"
        />
        <div className="model-viewer__tools">
          <button
            type="button"
            disabled={!ready}
            aria-pressed={grid}
            onClick={() => {
              setGrid(!grid);
              player.current?.grid(!grid);
            }}
          >
            <Grid3X3 size={15} /> 격자
          </button>
          <button
            type="button"
            disabled={!ready}
            aria-pressed={pan}
            title="드래그로 시점 이동"
            onClick={() => {
              setPan(!pan);
              player.current?.pan(!pan);
            }}
          >
            <Move size={15} /> Pan
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={() => player.current?.fit()}
          >
            <RotateCcw size={15} /> 시점 초기화
          </button>
        </div>
        {ready && (
          <small className="model-viewer__gesture">
            {pan ? '드래그로 시점 이동' : '드래그로 회전'} · 휠로 확대·축소
          </small>
        )}
        {!ready && (
          <div className="model-viewer__status" role="status">
            <span>{error || '3D 모델을 불러오는 중…'}</span>
            {error && (
              <button type="button" onClick={retry}>
                다시 읽기
              </button>
            )}
          </div>
        )}
      </div>
      {ready && (
        <footer className="model-viewer__footer">
          {current ? (
            <>
              <div className="model-viewer__clip">
                <label>
                  애니메이션{' '}
                  <select
                    value={clip}
                    onChange={(event) => {
                      const index = Number(event.currentTarget.value);
                      setClip(index);
                      player.current?.select(index);
                    }}
                  >
                    {details.clips.map((item, index) => (
                      <option key={index} value={index}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  aria-pressed={repeat}
                  onClick={() => {
                    setRepeat(!repeat);
                    player.current?.loop(!repeat);
                  }}
                >
                  <Repeat2 size={16} /> 반복
                </button>
              </div>
              <div className="model-viewer__transport">
                <button
                  type="button"
                  className="model-viewer__play"
                  aria-label={frame.playing ? '일시정지' : '재생'}
                  onClick={() => player.current?.toggle()}
                >
                  {frame.playing ? (
                    <Pause size={17} fill="currentColor" />
                  ) : (
                    <Play size={17} fill="currentColor" />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={current.duration}
                  step="any"
                  aria-label="애니메이션 재생 위치"
                  value={Math.min(frame.time, current.duration)}
                  onChange={(event) =>
                    player.current?.seek(Number(event.currentTarget.value))
                  }
                />
                <span>
                  {frame.time.toFixed(1)} / {current.duration.toFixed(1)}초
                </span>
              </div>
            </>
          ) : (
            <p className="model-viewer__note">
              <Box size={16} /> 정적 모델 · 내장 애니메이션 없음
            </p>
          )}
          {details.skeletonOnly && (
            <p className="model-viewer__note">
              리그만 포함된 파일입니다. 뼈대로 움직임을 표시합니다.
            </p>
          )}
          {details.missingTextures && (
            <p className="model-viewer__note">
              외부 텍스처가 연결된 표면은 기본 재질로 표시합니다.
            </p>
          )}
        </footer>
      )}
    </dialog>,
    document.body,
  );
}
