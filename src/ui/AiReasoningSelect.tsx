import type { AiProviderId, AiReasoningEffort } from '../shared';
import { reasoningLabel, reasoningOptions } from '../core/ai/catalog.ts';

export function AiReasoningSelect({
  provider,
  model,
  value,
  onChange,
  disabled,
  id,
  label = '추론 수준',
}: {
  provider: AiProviderId;
  model: string;
  value?: AiReasoningEffort | null;
  onChange: (value: AiReasoningEffort | null) => void;
  disabled?: boolean;
  id?: string;
  label?: string;
}) {
  const options = reasoningOptions(provider, model);
  return (
    <label className="ai-reasoning-field">
      {label}
      <select
        id={id}
        aria-label={label}
        value={value ?? ''}
        disabled={disabled || (!options.length && !value)}
        aria-invalid={value ? !options.includes(value) : undefined}
        onChange={(event) =>
          onChange((event.target.value || null) as AiReasoningEffort | null)
        }
      >
        <option value="">기본값</option>
        {value && !options.includes(value) && (
          <option value={value} disabled>
            이전 설정 · {reasoningLabel(value)} (지원 확인 필요)
          </option>
        )}
        {options.map((effort) => (
          <option key={effort} value={effort}>
            {reasoningLabel(effort)}
          </option>
        ))}
      </select>
      <small>
        {!options.length
          ? '정확한 모델 버전을 선택하면 지원되는 추론 수준을 지정할 수 있습니다.'
          : value === 'ultra'
            ? '여러 에이전트가 작업을 나눠 진행합니다. 지원하는 Codex 버전과 계정이 필요합니다.'
            : '높일수록 깊이 검토하며, 시간과 사용량이 늘어날 수 있습니다. 기본값은 AI 설정을 따릅니다.'}
      </small>
    </label>
  );
}
