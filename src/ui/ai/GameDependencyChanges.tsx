import { useState } from 'react';
import type { GameDependencyChange } from '../../contracts/dependency-preparation';
import type { GameBuildStatus } from '../../contracts/game-build-status';
import {
  gameDependencyChanges,
  isRegistryPackageName,
} from '../../core/ai/dependency-preparation.ts';

const actions = { add: '추가', remove: '삭제', update: '버전 변경' } as const;

export function dependencyChangeLabel(change: GameDependencyChange) {
  const version =
    change.action === 'remove' ? '' : ` · ${change.version ?? '최신 버전'}`;
  return `${change.name} ${actions[change.action]}${version}`;
}

export function GameDependencyChanges({
  build,
  changes,
  suggestions,
  busy,
  onChange,
}: {
  build: GameBuildStatus;
  changes: GameDependencyChange[];
  suggestions: { name: string; reason: string }[];
  busy: boolean;
  onChange(changes: GameDependencyChange[]): void;
}) {
  const [action, setAction] = useState<GameDependencyChange['action']>('add');
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [error, setError] = useState('');
  const available = build.libraries.filter(
    (item) => !changes.some((change) => change.name === item.name),
  );
  const selectedName =
    action === 'add'
      ? name
      : (available.find((item) => item.name === name)?.name ??
        available[0]?.name ??
        '');
  const apply = (change: GameDependencyChange) => {
    try {
      const exists = build.libraries.some((item) => item.name === change.name);
      if (exists === (change.action === 'add'))
        throw Error(
          exists
            ? '이미 사용 중인 패키지입니다. 버전 변경을 선택해주세요.'
            : '기존 게임의 라이브러리를 선택해주세요.',
        );
      onChange(gameDependencyChanges([...changes, change])!);
      setError('');
      setName('');
      setVersion('');
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const submit = () => {
    const packageName = selectedName.trim();
    if (!isRegistryPackageName(packageName)) {
      setError('올바른 npm 패키지 이름을 입력해주세요.');
      return;
    }
    apply(
      action === 'remove'
        ? { action, name: packageName }
        : {
            action,
            name: packageName,
            ...(version.trim() ? { version: version.trim() } : {}),
          },
    );
  };
  return (
    <details
      className="ai-dependency-changes"
      open={changes.length || suggestions.length ? true : undefined}
    >
      <summary id="ai-dependency-changes" tabIndex={-1}>
        라이브러리 변경 {changes.length ? `· ${changes.length}건` : ''}
      </summary>
      <p>
        추가하거나 삭제할 패키지를 선택하세요. 교체하려면 기존 패키지를 삭제하고
        새 패키지를 추가하세요.
      </p>
      {suggestions
        .filter(
          ({ name }) =>
            !build.libraries.some((item) => item.name === name) &&
            !changes.some((change) => change.name === name),
        )
        .map((item) => (
          <p key={item.name}>
            <button
              type="button"
              disabled={busy}
              onClick={() => apply({ action: 'add', name: item.name })}
            >
              {item.name} 추가
            </button>{' '}
            {item.reason}
          </p>
        ))}
      {changes.length > 0 && (
        <ul>
          {changes.map((change) => (
            <li key={change.name}>
              {dependencyChangeLabel(change)}{' '}
              <button
                type="button"
                disabled={busy}
                aria-label={`${change.name} 변경 취소`}
                onClick={() =>
                  onChange(changes.filter((item) => item !== change))
                }
              >
                취소
              </button>
            </li>
          ))}
        </ul>
      )}
      <label>
        변경 방식
        <select
          value={action}
          disabled={busy}
          onChange={(event) => {
            setAction(event.target.value as typeof action);
            setName('');
            setError('');
          }}
        >
          <option value="add">추가</option>
          <option value="remove" disabled={!available.length}>
            삭제
          </option>
          <option value="update" disabled={!available.length}>
            버전 변경
          </option>
        </select>
      </label>
      <label>
        npm 패키지
        {action === 'add' ? (
          <input
            value={name}
            disabled={busy}
            maxLength={214}
            placeholder="예: tegaki"
            onChange={(event) => setName(event.target.value)}
          />
        ) : (
          <select
            value={selectedName}
            disabled={busy || !available.length}
            onChange={(event) => setName(event.target.value)}
          >
            {available.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name} {item.version}
              </option>
            ))}
          </select>
        )}
      </label>
      {action !== 'remove' && (
        <label>
          버전 (선택)
          <input
            value={version}
            disabled={busy}
            maxLength={120}
            placeholder="비우면 최신 버전"
            onChange={(event) => setVersion(event.target.value)}
          />
        </label>
      )}
      <button
        type="button"
        disabled={busy || !selectedName.trim()}
        onClick={submit}
      >
        변경 목록에 넣기
      </button>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
