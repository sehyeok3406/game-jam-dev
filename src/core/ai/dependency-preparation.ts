import {
  DependencyPreparationLimits as Limits,
  type DependencyRequestV1,
  type DependencyExchangeRequestV1,
  type GameDependencyChange,
} from '../../contracts/dependency-preparation.ts';
import type { GameBuildDependenciesV1 } from '../../contracts/game-build.ts';
export const isRegistryPackageName = (name: unknown): name is string =>
  typeof name === 'string' &&
  name.length <= 214 &&
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) &&
  !name.includes('..') &&
  !['node_modules', '__proto__', 'constructor', 'prototype'].includes(name);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function fail(message: string): never {
  throw Error(`라이브러리 준비: ${message}`);
}
const exactVersion = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?(?:\+[a-z0-9.-]+)?$/i;

export function gameDependencyChanges(
  value: unknown,
): GameDependencyChange[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value) || !value.length || value.length > Limits.roots * 2)
    fail('라이브러리 변경 목록을 확인해주세요.');
  const names = new Set<string>();
  return value.map((change: unknown): GameDependencyChange => {
    if (
      !object(change) ||
      !isRegistryPackageName(change.name) ||
      names.has(change.name) ||
      (change.action !== 'add' &&
        change.action !== 'remove' &&
        change.action !== 'update') ||
      Object.keys(change).some(
        (key) =>
          ![
            'action',
            'name',
            ...(change.action === 'remove' ? [] : ['version']),
          ].includes(key),
      ) ||
      (change.version !== undefined &&
        (typeof change.version !== 'string' ||
          change.version.length > 120 ||
          !exactVersion.test(change.version)))
    )
      fail('라이브러리 변경의 패키지 이름·동작·버전을 확인해주세요.');
    names.add(change.name);
    return change.action === 'remove'
      ? { action: 'remove', name: change.name }
      : {
          action: change.action,
          name: change.name,
          ...(change.version ? { version: change.version } : {}),
        };
  });
}

export function dependencySelection(
  previous: GameBuildDependenciesV1,
  changes: readonly GameDependencyChange[],
) {
  validateDependencyLock(previous);
  const selected = new Map(
    Object.entries(previous.roots).map(([name, key]) => [
      name,
      {
        name,
        version: previous.packages.find((p) => p.key === key)!.version,
        reason: '기존 버전 유지',
      },
    ]),
  );
  for (const change of changes) {
    if (selected.has(change.name) === (change.action === 'add'))
      fail(
        `${change.name}의 변경 방식이 기존 라이브러리 목록과 맞지 않습니다.`,
      );
    if (change.action === 'remove') selected.delete(change.name);
    else
      selected.set(change.name, {
        name: change.name,
        version: change.version ?? 'latest',
        reason: '사용자가 요청한 변경',
      });
  }
  if (selected.size > Limits.roots)
    fail(
      `직접 사용하는 라이브러리는 ${Limits.roots}개까지 선택할 수 있습니다.`,
    );
  return [...selected.values()];
}

export function assertDependencyChanges(
  previous: GameBuildDependenciesV1,
  next: GameBuildDependenciesV1,
  changes?: readonly GameDependencyChange[],
) {
  if (!changes) {
    if (JSON.stringify(previous) !== JSON.stringify(next))
      fail('기존 게임의 고정 라이브러리 버전을 유지해야 합니다.');
    return;
  }
  const selected = dependencySelection(previous, changes);
  validateDependencyLock(next);
  const byKey = new Map(next.packages.map((item) => [item.key, item]));
  const before = new Map(previous.packages.map((item) => [item.key, item]));
  const roots = new Set(changes.map((change) => change.name));
  if (Object.keys(next.roots).length !== selected.length)
    fail('결과의 라이브러리 목록이 요청한 변경과 일치하지 않습니다.');
  for (const { name, version } of selected) {
    const current = byKey.get(next.roots[name]);
    const prior = before.get(previous.roots[name]);
    if (
      !current ||
      (version !== 'latest' && current.version !== version) ||
      (!roots.has(name) &&
        (current.integrity !== prior?.integrity ||
          current.resolved !== prior.resolved ||
          current.license !== prior.license))
    )
      fail(`${name}의 결과가 요청한 라이브러리 변경과 일치하지 않습니다.`);
  }
  const pending = Object.values(next.roots);
  const reachable = new Set<string>();
  for (let index = 0; index < pending.length; index++) {
    const key = pending[index];
    if (reachable.has(key)) continue;
    reachable.add(key);
    pending.push(...byKey.get(key)!.dependencies);
  }
  if (reachable.size !== next.packages.length)
    fail('라이브러리 결과에 연결되지 않은 패키지가 있습니다.');
}

export function validateDependencyLock(
  value: unknown,
): asserts value is GameBuildDependenciesV1 {
  if (
    !object(value) ||
    value.version !== 1 ||
    !object(value.roots) ||
    !Array.isArray(value.packages) ||
    value.packages.length > Limits.packages
  )
    fail('고정 의존성 형식');
  const keys = new Set<string>();
  for (const p of value.packages) {
    if (
      !object(p) ||
      typeof p.key !== 'string' ||
      p.key.length > 240 ||
      !/^(?:node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)(?:\/node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)*$/.test(
        p.key,
      ) ||
      p.key.includes('..') ||
      keys.has(p.key) ||
      !isRegistryPackageName(p.name) ||
      !(
        p.key === `node_modules/${p.name}` ||
        p.key.endsWith(`/node_modules/${p.name}`)
      ) ||
      typeof p.version !== 'string' ||
      !exactVersion.test(p.version) ||
      typeof p.resolved !== 'string' ||
      !/^https:\/\/registry\.npmjs\.org\/[^?#\s\\]+$/.test(p.resolved) ||
      typeof p.integrity !== 'string' ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(p.integrity) ||
      !Array.isArray(p.dependencies) ||
      typeof p.license !== 'string' ||
      !p.license ||
      p.license.length > 1024
    )
      fail('지원하지 않는 package 출처·버전·무결성·경로');
    keys.add(p.key);
  }
  for (const [name, key] of Object.entries(value.roots))
    if (
      !isRegistryPackageName(name) ||
      typeof key !== 'string' ||
      key !== `node_modules/${name}` ||
      !keys.has(key) ||
      value.packages.find((p) => p.key === key)?.name !== name
    )
      fail('직접 의존성 연결');
  for (const p of value.packages)
    if (
      p.dependencies.some(
        (key: unknown) => typeof key !== 'string' || !keys.has(key),
      )
    )
      fail('간접 의존성 연결');
}
export function parseDependencyRequest(value: unknown): DependencyRequestV1 {
  if (!object(value) || value.version !== 1) fail('요청 버전');
  const fields =
    value.action === 'research'
      ? ['version', 'action', 'names']
      : value.action === 'prepare'
        ? [
            'version',
            'action',
            'packages',
            'previousLock',
            'upgrades',
            'changes',
          ]
        : ['version', 'action', 'lockSha256'];
  if (Object.keys(value).some((key) => !fields.includes(key)))
    fail('허용하지 않은 요청 필드');
  if (value.action === 'research') {
    if (
      !Array.isArray(value.names) ||
      !value.names.length ||
      value.names.length > Limits.roots ||
      !value.names.every(isRegistryPackageName) ||
      new Set(value.names).size !== value.names.length
    )
      fail('조사할 패키지 이름');
  } else if (value.action === 'prepare') {
    if (!Array.isArray(value.packages) || value.packages.length > Limits.roots)
      fail('선택한 패키지 개수');
    const names = new Set<string>();
    const packages = value.packages;
    for (const p of packages) {
      if (
        !object(p) ||
        Object.keys(p).some(
          (key) => !['name', 'version', 'reason'].includes(key),
        ) ||
        !isRegistryPackageName(p.name) ||
        names.has(p.name) ||
        typeof p.version !== 'string' ||
        p.version.length > 120 ||
        !/^[0-9a-zA-Z.*^~<>=|+ -]+$/.test(p.version) ||
        typeof p.reason !== 'string' ||
        p.reason.length > 2000
      )
        fail('패키지 이름·버전·선택 이유');
      names.add(p.name);
    }
    if (value.previousLock !== undefined)
      validateDependencyLock(value.previousLock);
    if (value.changes !== undefined) {
      const changes = gameDependencyChanges(value.changes)!;
      if (!value.previousLock || value.upgrades !== undefined)
        fail('기존 라이브러리와 요청한 변경을 확인해주세요.');
      const selection = dependencySelection(
        value.previousLock as GameBuildDependenciesV1,
        changes,
      );
      if (
        selection.length !== names.size ||
        selection.some(
          (p) =>
            !packages.some(
              (item: { name: string; version: string }) =>
                item.name === p.name && item.version === p.version,
            ),
        )
      )
        fail('라이브러리 준비 대상이 요청한 변경과 일치하지 않습니다.');
    }
    if (
      value.upgrades !== undefined &&
      (!Array.isArray(value.upgrades) ||
        !value.upgrades.every(
          (name) => typeof name === 'string' && names.has(name),
        ))
    )
      fail('업그레이드 대상');
  } else if (
    value.action !== 'done' ||
    !(
      value.lockSha256 === null ||
      (typeof value.lockSha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(value.lockSha256))
    )
  )
    fail('완료된 준비 결과');
  return value as DependencyRequestV1;
}
export function parseDependencyExchange(
  value: unknown,
  runId: string,
  sequence: number,
): DependencyExchangeRequestV1 {
  if (
    !object(value) ||
    value.version !== 1 ||
    value.runId !== runId ||
    value.sequence !== sequence ||
    Object.keys(value).some(
      (key) => !['version', 'runId', 'sequence', 'request'].includes(key),
    )
  )
    fail('오래되었거나 다른 실행의 교환 파일');
  return {
    version: 1,
    runId,
    sequence,
    request: parseDependencyRequest(value.request),
  };
}
