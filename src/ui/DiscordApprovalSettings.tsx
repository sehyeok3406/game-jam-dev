import { useRuntime } from './runtime/RuntimeProvider';
import { useEffect, useState } from 'react';
import { AI_PROVIDERS, reasoningError } from '../core/ai/catalog.ts';
import { AiReasoningSelect } from './AiReasoningSelect';
import type { AiProviderId } from '../shared';
import type {
  DiscordApprovalSettings as Settings,
  DiscordApprovalStatus,
} from '../discord-approval-types';

export function DiscordApprovalSettings({
  provider,
  model,
  connected,
}: {
  provider: AiProviderId;
  model: string;
  connected: boolean;
}) {
  const { api: runtimeApi } = useRuntime();

  const api = runtimeApi.desktop?.discordApproval;
  const [status, setStatus] = useState<DiscordApprovalStatus | null>(null);
  const [settings, setSettings] = useState<Settings>({
    channelId: '',
    userId: '',
    providerId: provider,
    modelId: model,
    threads: true,
  });
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!api) return;
    let active = true;
    void api
      .status()
      .then((value) => {
        if (!active) return;
        setStatus(value);
        if (value.settings) setSettings(value.settings);
      })
      .catch(() => {
        if (active) setError('디스코드 설정을 읽지 못했습니다.');
      });
    const timer = setInterval(() => {
      void api
        .status()
        .then((value) => {
          if (active) setStatus(value);
        })
        .catch(() => undefined);
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [api]);
  if (!api) return null;
  const perform = async (disconnect: boolean) => {
    setBusy(true);
    setError('');
    try {
      setStatus(
        disconnect
          ? await api.disconnect()
          : await api.configure({ ...settings, token: token || undefined }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '연결하지 못했습니다.');
    } finally {
      setToken('');
      setBusy(false);
    }
  };
  return (
    <details
      className="discord-approval-settings"
      data-ui-id="discord-approval-settings"
    >
      <summary>
        디스코드 원격 승인 {status?.connected ? '· 연결됨' : ''}
      </summary>
      <p>
        이 공동 프로젝트의 알림을 보내고, 지정한 디스코드 계정이 현재 Game Jam!
        관리자 권한으로 승인하도록 연결합니다.
      </p>
      <p>
        이 PC와 앱을 켜고 해당 프로젝트를 열어두어야 합니다. 봇 토큰은 이 PC에
        암호화해 저장합니다.
      </p>
      <fieldset disabled={busy}>
        <label>
          봇 토큰
          <input
            aria-label="디스코드 봇 토큰"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={
              status?.configured
                ? '저장됨 · 교체할 때만 입력'
                : 'Developer Portal → Bot의 토큰'
            }
          />
        </label>
        <label>
          알림 채널 ID
          <input
            aria-label="디스코드 채널 ID"
            inputMode="numeric"
            value={settings.channelId}
            onChange={(e) =>
              setSettings({ ...settings, channelId: e.target.value.trim() })
            }
          />
        </label>
        <label>
          승인할 사용자 ID
          <input
            aria-label="디스코드 관리자 사용자 ID"
            inputMode="numeric"
            value={settings.userId}
            onChange={(e) =>
              setSettings({ ...settings, userId: e.target.value.trim() })
            }
          />
        </label>
        <label>
          원격 실행 AI
          <select
            aria-label="디스코드 실행 AI"
            value={settings.providerId}
            onChange={(e) =>
              setSettings({
                ...settings,
                providerId: e.target.value as AiProviderId,
                modelId: '',
                reasoningEffort: null,
              })
            }
          >
            {AI_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          원격 실행 모델
          <input
            aria-label="디스코드 실행 모델"
            maxLength={128}
            value={settings.modelId}
            onChange={(e) =>
              setSettings({
                ...settings,
                modelId: e.target.value,
                reasoningEffort: reasoningError(
                  settings.providerId,
                  e.target.value,
                  settings.reasoningEffort,
                )
                  ? null
                  : settings.reasoningEffort,
              })
            }
            placeholder="비우면 기본 모델"
          />
        </label>
        <AiReasoningSelect
          label="원격 실행 추론 수준"
          provider={settings.providerId}
          model={settings.modelId}
          value={settings.reasoningEffort}
          onChange={(value) =>
            setSettings({ ...settings, reasoningEffort: value })
          }
          disabled={busy}
        />
        <label className="discord-threads">
          <input
            type="checkbox"
            checked={settings.threads}
            onChange={(e) =>
              setSettings({ ...settings, threads: e.target.checked })
            }
          />
          요청별 스레드에 진행 상황 기록
        </label>
        <div className="discord-settings-actions">
          <button
            className="button-primary"
            disabled={
              !connected ||
              !status ||
              !settings.channelId ||
              !settings.userId ||
              (!token && !status.configured)
            }
            onClick={() => void perform(false)}
          >
            {busy ? '처리 중…' : '저장하고 연결'}
          </button>
          {status?.configured && (
            <button onClick={() => void perform(true)}>
              연결 해제·토큰 삭제
            </button>
          )}
        </div>
      </fieldset>
      {status && (
        <p role="status">
          {status.projectName ? `${status.projectName} · ` : ''}
          {status.message}
        </p>
      )}
      {error && (
        <p role="alert" className="approval-error">
          {error}
        </p>
      )}
    </details>
  );
}
