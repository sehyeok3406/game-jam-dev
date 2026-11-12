import {
  AudioLines,
  ChevronDown,
  ChevronUp,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { AudioAsset } from '../../contracts/documents';
import { CanvasItemResizer } from '../canvas/CanvasItemResizer';
import { useCanvasMode, useCanvasResource } from '../canvas/CanvasContent';
import { useRuntime } from '../runtime/RuntimeProvider';
import type { DocumentNodeData } from './types';
import './audio-node.css';

let activeAudio: HTMLAudioElement | undefined;
const maxWaveformDuration = 300;
const bars = 82;

function timeLabel(time: number) {
  const seconds = Math.floor(time);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

async function waveform(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw Error('파형을 읽을 수 없습니다.');
  const bytes = await response.arrayBuffer();
  signal.throwIfAborted();
  const audio = await new OfflineAudioContext(1, 1, 8000).decodeAudioData(
    bytes,
  );
  signal.throwIfAborted();
  const samples = audio.getChannelData(0);
  const levels = Array.from({ length: bars }, (_, index) => {
    const start = Math.floor((index * samples.length) / bars);
    const end = Math.floor(((index + 1) * samples.length) / bars);
    let squares = 0;
    for (let i = start; i < end; i += 1) squares += samples[i] * samples[i];
    return Math.sqrt(squares / Math.max(1, end - start));
  });
  const peak = Math.max(0.001, ...levels);
  return levels.map((level) => Math.max(0.08, Math.pow(level / peak, 0.72)));
}

function AudioTimeline({
  url,
  duration,
  time,
  seek,
}: {
  url: string;
  duration: number;
  time: number;
  seek: (time: number) => void;
}) {
  const canDecode = duration > 0 && duration <= maxWaveformDuration;
  const { value } = useCanvasResource(
    `audio-waveform:${url}`,
    [url, canDecode],
    (signal) => (canDecode ? waveform(url, signal) : []),
    (value) => value.length * 8,
  );
  const percent = duration > 0 ? (time / duration) * 100 : 0;
  return (
    <div
      className="audio-node__timeline nodrag nowheel"
      data-waveform={!!value?.length}
      style={{ '--played': `${percent}%` } as CSSProperties}
    >
      {value?.length ? (
        <>
          <div className="audio-node__wave" aria-hidden="true">
            {value.map((level, index) => (
              <i
                key={index}
                className={
                  (index / bars) * 100 < percent ? 'played' : undefined
                }
                style={{ height: `${level * 100}%` }}
              />
            ))}
          </div>
          <span className="audio-node__playhead" aria-hidden="true" />
        </>
      ) : null}
      <input
        type="range"
        aria-label="재생 위치"
        aria-valuetext={timeLabel(time)}
        min={0}
        max={duration || 1}
        step="any"
        value={time}
        disabled={!duration}
        onChange={(event) => seek(Number(event.currentTarget.value))}
      />
    </div>
  );
}

export const AudioNode = memo(function AudioNode({
  asset,
  data,
  selected,
}: {
  asset: AudioAsset;
  data: DocumentNodeData;
  selected: boolean;
}) {
  const { api, preferences } = useRuntime();
  const mode = useCanvasMode();
  const audio = useRef<HTMLAudioElement>(null);
  const [requested, setRequested] = useState(false);
  const [source, setSource] = useState({ url: '', error: '' });
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const volumeKey = `gamejam:audio-volume:${data.saveScope}:${data.document.id}`;
  const [volume, setVolume] = useState(() => {
    try {
      const saved = preferences.getItem(volumeKey);
      const value = saved === null ? 0.7 : Number(saved);
      return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0.7;
    } catch {
      return 0.7;
    }
  });

  useEffect(() => {
    if (mode === 2 && !data.sectionHidden) setRequested(true);
  }, [mode, data.sectionHidden]);

  useEffect(() => {
    if (!requested) return;
    let current = true;
    void api.editor.readAsset(asset.path).then(
      (url) => {
        if (current) setSource({ url, error: '' });
      },
      (error: unknown) => {
        if (current)
          setSource({
            url: '',
            error:
              error instanceof Error
                ? error.message.replace(/^.*?Error: /, '')
                : String(error),
          });
      },
    );
    return () => {
      current = false;
    };
  }, [api, asset.path, requested, attempt]);

  useEffect(() => {
    const element = audio.current;
    return () => {
      if (activeAudio === element) activeAudio = undefined;
      element?.pause();
    };
  }, [source.url]);

  useEffect(() => {
    if (data.sectionHidden) audio.current?.pause();
  }, [data.sectionHidden]);

  useEffect(() => {
    if (audio.current) {
      audio.current.volume = volume;
      audio.current.muted = muted;
    }
  }, [volume, muted, source.url]);

  const { document } = data;
  function setPlayerVolume(next: number) {
    setVolume(next);
    setMuted(false);
    try {
      preferences.setItem(volumeKey, String(next));
    } catch {
      // Playback still uses the current volume if local preferences are unavailable.
    }
  }

  function togglePlay() {
    const element = audio.current;
    if (!element || data.sectionHidden) return;
    if (!element.paused) element.pause();
    else
      void element.play().catch((error: unknown) => {
        if (
          audio.current === element &&
          !(error instanceof DOMException && error.name === 'AbortError')
        )
          setSource({
            url: '',
            error: '사운드를 재생할 수 없습니다. 파일 형식을 확인해주세요.',
          });
      });
  }

  const volumeLevel = muted ? 0 : volume;
  return (
    <>
      {!document.collapsed && (
        <CanvasItemResizer
          color="var(--selection)"
          isVisible={selected && !data.layoutLocked}
          lineClassName="window-resize-edge"
          handleClassName="window-resize-handle"
          minWidth={300}
          minHeight={180}
          onResizeEnd={(_event, params) => {
            void data.onResize(
              document,
              params.x,
              params.y,
              params.width,
              params.height,
            );
          }}
        />
      )}
      <article
        className="audio-node"
        data-find-document={document.id}
        data-collapsed={document.collapsed}
        inert={data.sectionHidden || undefined}
      >
        <header className="document-card__header audio-node__header">
          <AudioLines size={16} aria-hidden="true" />
          <strong title={document.title}>{document.title}</strong>
          <small>{(asset.bytes / 1_000_000).toFixed(1)} MB</small>
          <button
            type="button"
            className="nodrag"
            onClick={data.onCollapse}
            aria-expanded={!document.collapsed}
            aria-label={
              document.collapsed ? '사운드 노드 펼치기' : '사운드 노드 접기'
            }
          >
            {document.collapsed ? (
              <ChevronDown size={16} />
            ) : (
              <ChevronUp size={16} />
            )}
          </button>
        </header>
        {source.url && (
          <audio
            ref={audio}
            src={source.url}
            preload="metadata"
            onPlay={(event) => {
              const element = event.currentTarget;
              if (data.sectionHidden) {
                element.pause();
                return;
              }
              if (activeAudio !== element) activeAudio?.pause();
              activeAudio = element;
              setPlaying(true);
            }}
            onPause={(event) => {
              if (activeAudio === event.currentTarget) activeAudio = undefined;
              setPlaying(false);
            }}
            onEnded={() => setPlaying(false)}
            onDurationChange={(event) => {
              const length = event.currentTarget.duration;
              setDuration(Number.isFinite(length) ? length : 0);
            }}
            onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
            onError={() =>
              setSource({
                url: '',
                error: '사운드를 읽을 수 없습니다. 원본 파일을 확인해주세요.',
              })
            }
          />
        )}
        <div className="audio-node__body">
          {!document.collapsed &&
            (source.error ? (
              <div className="audio-node__error nodrag" role="status">
                <span>{source.error}</span>
                <button
                  type="button"
                  onClick={() => {
                    setSource({ url: '', error: '' });
                    setPlaying(false);
                    setTime(0);
                    setDuration(0);
                    setAttempt((value) => value + 1);
                  }}
                >
                  다시 읽기
                </button>
              </div>
            ) : (
              <AudioTimeline
                url={source.url}
                duration={duration}
                time={time}
                seek={(next) => {
                  if (!audio.current) return;
                  audio.current.currentTime = next;
                  setTime(next);
                }}
              />
            ))}
          <div className="audio-node__controls nodrag nowheel">
            <button
              type="button"
              className="audio-node__play"
              onClick={togglePlay}
              disabled={!source.url}
              aria-label={playing && source.url ? '일시정지' : '재생'}
            >
              {playing ? (
                <Pause size={15} fill="currentColor" />
              ) : (
                <Play size={15} fill="currentColor" />
              )}
            </button>
            <span className="audio-node__time">
              {timeLabel(time)}{' '}
              <small>/ {duration ? timeLabel(duration) : '–:––'}</small>
            </span>
            {!document.collapsed && (
              <div className="audio-node__volume">
                <button
                  type="button"
                  aria-label={muted ? '음소거 해제' : '음소거'}
                  aria-pressed={muted}
                  onClick={() => setMuted(!muted)}
                >
                  {volumeLevel ? <Volume2 size={16} /> : <VolumeX size={16} />}
                </button>
                <input
                  type="range"
                  aria-label="음량"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volumeLevel}
                  onChange={(event) =>
                    setPlayerVolume(Number(event.currentTarget.value))
                  }
                />
                <small>{Math.round(volumeLevel * 100)}%</small>
              </div>
            )}
          </div>
        </div>
      </article>
    </>
  );
});
