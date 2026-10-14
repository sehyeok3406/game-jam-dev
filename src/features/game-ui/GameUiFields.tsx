import { useEffect, useId, useRef, useState } from 'react';

type Commit<T> = (value: T) => void | Promise<unknown>;
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function GameUiNumberField({
  label,
  value,
  apply,
  min = 0,
  max = 4096,
  preview,
  cancel,
  unit,
  compact = false,
  step = 1,
  displayLabel,
  integer = false,
}: {
  label: string;
  value: number | string;
  apply: Commit<number>;
  min?: number;
  max?: number;
  preview?: (value: number) => void;
  cancel?: () => void;
  unit?: string;
  compact?: boolean;
  step?: number;
  displayLabel?: string;
  integer?: boolean;
}) {
  const id = useId(),
    input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const focused = useRef(false),
    cancelled = useRef(false);
  const latest = useRef({ value, apply });
  latest.current = { value, apply };
  const started = useRef({ value, apply });
  const scrub = useRef<{ x: number; value: number; moved: boolean } | null>(
    null,
  );
  useEffect(() => {
    if (
      !focused.current &&
      !scrub.current &&
      !inFlight.current &&
      !error &&
      !saving &&
      input.current
    ) {
      input.current.value = String(value);
      started.current = latest.current;
    }
  }, [value, apply, error, saving]);
  const valid = (raw: string) =>
    raw.trim() !== '' &&
    Number.isFinite(Number(raw)) &&
    Number(raw) >= min &&
    Number(raw) <= max &&
    (!integer || Number.isInteger(Number(raw)));
  const commit = async () => {
    if (!input.current || cancelled.current || inFlight.current) return;
    const raw = input.current.value;
    if (raw === '' && started.current.value === '') {
      cancel?.();
      return;
    }
    if (!valid(raw)) {
      cancel?.();
      setError(
        `${label}: ${min.toLocaleString()}~${max.toLocaleString()}${unit ?? ''} 범위의 ${integer ? '정수' : '숫자'}를 입력해주세요.`,
      );
      return;
    }
    setError('');
    const next = Number(raw);
    if (next === started.current.value) {
      input.current.value = String(latest.current.value);
      cancel?.();
      return;
    }
    setSaving(true);
    inFlight.current = true;
    try {
      await started.current.apply(next);
      started.current = { value: next, apply: latest.current.apply };
    } catch (e) {
      cancel?.();
      setError(
        message(e) +
          (latest.current.value !== started.current.value
            ? ` 현재 저장 값: ${latest.current.value} / 입력 값: ${raw}`
            : ''),
      );
    } finally {
      setSaving(false);
      inFlight.current = false;
    }
  };
  const reset = () => {
    cancelled.current = true;
    if (input.current) input.current.value = String(latest.current.value);
    setError('');
    cancel?.();
  };
  return (
    <div className={`game-ui-field${compact ? ' game-ui-field--compact' : ''}`}>
      <label
        htmlFor={id}
        className="game-ui-number-label"
        title="드래그로 조절 · Shift: 큰 단위 · Alt: 작은 단위"
        onPointerDown={(e) => {
          if (
            e.button !== 0 ||
            !input.current ||
            input.current.matches(':disabled')
          )
            return;
          const n = Number(input.current.value);
          if (!valid(input.current.value)) return;
          e.preventDefault();
          started.current = latest.current;
          cancelled.current = false;
          scrub.current = { x: e.clientX, value: n, moved: false };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const s = scrub.current;
          if (!s || !input.current || Math.abs(e.clientX - s.x) < 3) return;
          s.moved = true;
          const amount = step * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
          let n = Math.max(
            min,
            Math.min(
              max,
              Number(
                (s.value + Math.round((e.clientX - s.x) / 4) * amount).toFixed(
                  6,
                ),
              ),
            ),
          );
          if (integer) n = Math.round(n);
          input.current.value = String(n);
          setError('');
          preview?.(n);
        }}
        onPointerUp={() => {
          const moved = scrub.current?.moved;
          scrub.current = null;
          if (moved) void commit();
          else input.current?.focus();
        }}
        onPointerCancel={() => {
          scrub.current = null;
          reset();
        }}
      >
        {displayLabel ?? label}
      </label>
      <span className="game-ui-input-wrap">
        <input
          id={id}
          ref={input}
          aria-label={label}
          type="number"
          step="any"
          defaultValue={value}
          placeholder={value === '' ? '혼합' : undefined}
          min={min}
          max={max}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          aria-busy={saving || undefined}
          onFocus={() => {
            focused.current = true;
            cancelled.current = false;
            started.current = latest.current;
          }}
          onChange={(e) => {
            cancelled.current = false;
            setError('');
            if (valid(e.target.value)) preview?.(Number(e.target.value));
            else cancel?.();
          }}
          onBlur={() => {
            focused.current = false;
            void commit();
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              reset();
              e.currentTarget.blur();
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
        {unit && (
          <span className="game-ui-unit" aria-hidden="true">
            {unit}
          </span>
        )}
      </span>
      {error && (
        <small id={`${id}-error`} className="game-ui-field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

export function GameUiTextField({
  label,
  value,
  apply,
  required = false,
  maxLength = 1000,
}: {
  label: string;
  value: string;
  apply: Commit<string>;
  required?: boolean;
  maxLength?: number;
}) {
  const id = useId(),
    input = useRef<HTMLInputElement>(null),
    focused = useRef(false);
  const [error, setError] = useState('');
  const current = useRef({ value, apply });
  current.current = { value, apply };
  const started = useRef(current.current),
    cancelled = useRef(false),
    inFlight = useRef(false);
  useEffect(() => {
    if (!focused.current && !inFlight.current && !error && input.current) {
      input.current.value = value;
      started.current = current.current;
    }
  }, [value, apply, error]);
  return (
    <div className="game-ui-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-label={label}
        ref={input}
        defaultValue={value}
        maxLength={maxLength}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        onFocus={() => {
          focused.current = true;
          cancelled.current = false;
          started.current = current.current;
        }}
        onChange={() => {
          cancelled.current = false;
          setError('');
        }}
        onBlur={async (e) => {
          focused.current = false;
          if (cancelled.current || inFlight.current) return;
          const next = required ? e.target.value.trim() : e.target.value;
          if (required && !next) {
            setError('이름을 입력해주세요.');
            return;
          }
          if (next === started.current.value) {
            e.target.value = current.current.value;
            return;
          }
          inFlight.current = true;
          try {
            await started.current.apply(next);
            started.current = { value: next, apply: current.current.apply };
          } catch (err) {
            setError(
              message(err) +
                (current.current.value !== started.current.value
                  ? ` 현재 저장 값: ${current.current.value} / 입력 값: ${next}`
                  : ''),
            );
          } finally {
            inFlight.current = false;
          }
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            cancelled.current = true;
            e.currentTarget.value = current.current.value;
            setError('');
            e.currentTarget.blur();
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
      {error && (
        <small id={`${id}-error`} className="game-ui-field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

export function GameUiColorField({
  label,
  value,
  apply,
  preview,
  cancel,
  opacity,
  applyOpacity,
  previewOpacity,
}: {
  label: string;
  value: string;
  apply: Commit<string>;
  preview?: (value: string) => void;
  cancel?: () => void;
  opacity?: number | string;
  applyOpacity?: Commit<number>;
  previewOpacity?: (value: number) => void;
}) {
  const id = useId(),
    input = useRef<HTMLInputElement>(null),
    picker = useRef<HTMLInputElement>(null),
    focused = useRef(false);
  const [error, setError] = useState('');
  const current = useRef({ value, apply });
  current.current = { value, apply };
  const started = useRef(current.current),
    cancelled = useRef(false),
    inFlight = useRef(false);
  useEffect(() => {
    if (!focused.current && !inFlight.current && !error && input.current) {
      input.current.value = value;
      if (picker.current) picker.current.value = value || '#64748b';
      started.current = current.current;
    }
  }, [value, apply, error]);
  const commit = async (raw: string) => {
    if (cancelled.current || inFlight.current) return;
    if (!/^#[a-f\d]{6}$/i.test(raw)) {
      cancel?.();
      setError('HEX 색상을 #112233 형식으로 입력해주세요.');
      return;
    }
    setError('');
    if (raw.toLowerCase() === started.current.value.toLowerCase()) {
      if (input.current) input.current.value = current.current.value;
      cancel?.();
      return;
    }
    inFlight.current = true;
    try {
      await started.current.apply(raw);
      started.current = { value: raw, apply: current.current.apply };
    } catch (err) {
      cancel?.();
      setError(
        message(err) +
          (current.current.value !== started.current.value
            ? ` 현재 저장 색: ${current.current.value} / 입력 색: ${raw}`
            : ''),
      );
    } finally {
      inFlight.current = false;
    }
  };
  useEffect(() => {
    const element = picker.current;
    if (!element) return;
    const changed = () => {
      focused.current = false;
      void commit(element.value);
    };
    element.addEventListener('change', changed);
    return () => element.removeEventListener('change', changed);
  }, [value, apply]);
  return (
    <div className="game-ui-color-row">
      <label htmlFor={id}>{label}</label>
      <div className="game-ui-color-inputs">
        <input
          type="color"
          ref={picker}
          aria-label={`${label} 선택`}
          defaultValue={value || '#64748b'}
          onFocus={() => {
            focused.current = true;
            started.current = current.current;
            cancelled.current = false;
          }}
          onInput={(e) => {
            if (cancelled.current) started.current = current.current;
            cancelled.current = false;
            focused.current = true;
            if (input.current) input.current.value = e.currentTarget.value;
            preview?.(e.currentTarget.value);
          }}
          onBlur={(e) => {
            focused.current = false;
            void commit(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              cancelled.current = true;
              cancel?.();
              if (input.current) input.current.value = current.current.value;
              e.currentTarget.value = current.current.value || '#64748b';
              e.currentTarget.blur();
            }
          }}
        />
        <input
          id={id}
          ref={input}
          aria-label={label}
          defaultValue={value}
          placeholder="혼합"
          maxLength={7}
          spellCheck={false}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          onFocus={() => {
            focused.current = true;
            cancelled.current = false;
            started.current = current.current;
          }}
          onChange={(e) => {
            cancelled.current = false;
            setError('');
            if (/^#[a-f\d]{6}$/i.test(e.target.value))
              preview?.(e.target.value);
            else cancel?.();
          }}
          onBlur={(e) => {
            focused.current = false;
            void commit(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              cancelled.current = true;
              e.currentTarget.value = current.current.value;
              if (picker.current)
                picker.current.value = current.current.value || '#64748b';
              setError('');
              cancel?.();
              e.currentTarget.blur();
            }
          }}
        />
        {applyOpacity && (
          <GameUiNumberField
            label={`${label.replace(/색$/, '').trim()} 불투명도 (%)`}
            value={opacity ?? 100}
            min={0}
            max={100}
            unit="%"
            compact
            apply={applyOpacity}
            preview={previewOpacity}
            cancel={cancel}
          />
        )}
      </div>
      {error && (
        <small id={`${id}-error`} className="game-ui-field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

export function GameUiRangeFields({
  minimum,
  maximum,
  current,
  apply,
  notify,
}: {
  minimum: number;
  maximum: number;
  current: number;
  apply: Commit<{ minimum: number; maximum: number }>;
  notify: (message: string) => void;
}) {
  const row = useRef<HTMLDivElement>(null),
    low = useRef<HTMLInputElement>(null),
    high = useRef<HTMLInputElement>(null);
  const id = useId(),
    [error, setError] = useState(''),
    [dirty, setDirty] = useState(false);
  const inFlight = useRef(false),
    cancelled = useRef(false);
  const latest = useRef({ minimum, maximum, apply });
  latest.current = { minimum, maximum, apply };
  const started = useRef(latest.current);
  useEffect(() => {
    if (!dirty && !inFlight.current) {
      if (low.current) low.current.value = String(minimum);
      if (high.current) high.current.value = String(maximum);
      started.current = latest.current;
    }
  }, [minimum, maximum, apply, dirty]);
  const reset = () => {
    cancelled.current = true;
    if (low.current) low.current.value = String(latest.current.minimum);
    if (high.current) high.current.value = String(latest.current.maximum);
    setDirty(false);
    setError('');
  };
  const commit = async () => {
    if (inFlight.current || cancelled.current || !low.current || !high.current)
      return;
    const min = Number(low.current.value),
      max = Number(high.current.value);
    if (
      !low.current.value.trim() ||
      !high.current.value.trim() ||
      !Number.isFinite(min) ||
      !Number.isFinite(max) ||
      Math.abs(min) > 1e9 ||
      Math.abs(max) > 1e9
    ) {
      setError(
        '최소·최대 값에 -1,000,000,000~1,000,000,000 범위의 숫자를 입력해주세요.',
      );
      return;
    }
    if (max <= min) {
      setError(
        '최대 값은 최소 값보다 커야 합니다. 두 값을 수정한 뒤 범위를 적용해주세요.',
      );
      return;
    }
    if (min === started.current.minimum && max === started.current.maximum) {
      setError('');
      setDirty(false);
      return;
    }
    inFlight.current = true;
    try {
      await started.current.apply({ minimum: min, maximum: max });
      const clamped = Math.min(max, Math.max(min, current));
      notify(
        clamped !== current
          ? `범위 변경으로 현재 값이 ${current} → ${clamped}로 조정되었습니다.`
          : '범위를 적용했습니다.',
      );
      started.current = {
        minimum: min,
        maximum: max,
        apply: latest.current.apply,
      };
      setDirty(false);
      setError('');
    } catch (e) {
      setError(message(e));
    } finally {
      inFlight.current = false;
    }
  };
  return (
    <div
      ref={row}
      className="game-ui-range-fields"
      onFocus={(e) => {
        if (!row.current?.contains(e.relatedTarget as Node) && !dirty)
          started.current = latest.current;
        cancelled.current = false;
      }}
      onBlur={(e) => {
        if (!row.current?.contains(e.relatedTarget as Node)) void commit();
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          void commit();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          reset();
          (e.target as HTMLElement).blur();
        }
      }}
    >
      <div className="game-ui-field-grid">
        <div className="game-ui-field">
          <label htmlFor={`${id}-min`}>최소 값</label>
          <input
            id={`${id}-min`}
            ref={low}
            aria-label="최소 값"
            type="number"
            step="any"
            defaultValue={minimum}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={() => {
              setDirty(true);
              setError('');
            }}
          />
        </div>
        <div className="game-ui-field">
          <label htmlFor={`${id}-max`}>최대 값</label>
          <input
            id={`${id}-max`}
            ref={high}
            aria-label="최대 값"
            type="number"
            step="any"
            defaultValue={maximum}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={() => {
              setDirty(true);
              setError('');
            }}
          />
        </div>
      </div>
      {(dirty || error) && (
        <div className="game-ui-actions">
          <button type="button" onClick={() => void commit()}>
            범위 적용
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={reset}
          >
            취소
          </button>
        </div>
      )}
      {error && (
        <small id={`${id}-error`} className="game-ui-field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
