import {
  DependencyPreparationLimits as Limits,
  type DependencyRequestV1,
  type DependencyExchangeRequestV1,
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
      !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?(?:\+[a-z0-9.-]+)?$/i.test(p.version) ||
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
        ? ['version', 'action', 'packages', 'previousLock', 'upgrades']
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
    for (const p of value.packages) {
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
