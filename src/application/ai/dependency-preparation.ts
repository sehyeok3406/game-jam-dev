import {
  DependencyPreparationLimits as Limits,
  type DependencyExchangeRequestV1,
  type PreparedDependenciesV1,
  type DependencyPreparationResult,
  type DependencyRequestV1,
} from '../../contracts/dependency-preparation.ts';
import {
  parseDependencyExchange,
  validateDependencyLock,
} from '../../core/ai/dependency-preparation.ts';
import type { GameBuildDependenciesV1 } from '../../contracts/game-build.ts';
export type DependencyPreparationEngine = {
  execute(
    request: Exclude<DependencyRequestV1, { action: 'done' }>,
    signal: AbortSignal,
  ): Promise<DependencyPreparationResult>;
};
export type DependencyPreparationExchange = {
  turn(
    sequence: number,
    response: DependencyPreparationResult | null,
    signal: AbortSignal,
  ): Promise<unknown>;
  close(): Promise<void>;
};
/** One bounded private exchange, bound to the existing run/session/lease by assertCurrent. */
export async function prepareGameDependencies(
  ports: {
    runId: string;
    engine: DependencyPreparationEngine;
    exchange: DependencyPreparationExchange;
    previousLock?: GameBuildDependenciesV1;
    allowedUpgrades?: string[];
    assertCurrent(): void;
    progress(message: string): void;
  },
  signal: AbortSignal,
): Promise<PreparedDependenciesV1 | null> {
  if (ports.previousLock) validateDependencyLock(ports.previousLock);
  const previous = ports.previousLock
    ? structuredClone(ports.previousLock)
    : undefined;
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timeout = setTimeout(
    () => controller.abort(Error('라이브러리 준비 시간 180초를 초과했습니다.')),
    Limits.timeoutMs,
  );
  const check = () => {
    controller.signal.throwIfAborted();
    ports.assertCurrent();
  };
  let response: DependencyPreparationResult | null = null,
    prepared: PreparedDependenciesV1 | null = null;
  try {
    for (let sequence = 1; sequence <= Limits.rounds; sequence++) {
      check();
      ports.progress(`라이브러리 자료 준비 · ${sequence}/${Limits.rounds}`);
      const raw = await ports.exchange.turn(
        sequence,
        response,
        controller.signal,
      );
      check();
      const item: DependencyExchangeRequestV1 = parseDependencyExchange(
        raw,
        ports.runId,
        sequence,
      );
      if (item.request.action === 'done') {
        if (previous?.packages.length && !prepared)
          throw Error('기존 게임의 고정 라이브러리를 먼저 준비해야 합니다.');
        if (item.request.lockSha256 !== (prepared?.lockSha256 ?? null))
          throw Error('확인한 라이브러리 준비 결과가 일치하지 않습니다.');
        return prepared;
      }
      let request = item.request;
      if (request.action === 'prepare') {
        if (request.previousLock && !previous)
          throw Error(
            '기존 고정 의존성은 앱이 제공한 정보만 사용할 수 있습니다.',
          );
        if (
          request.upgrades?.some(
            (name) => !ports.allowedUpgrades?.includes(name),
          )
        )
          throw Error(
            '사용자가 요청하지 않은 라이브러리 업그레이드는 허용하지 않습니다.',
          );
        if (previous) {
          if (
            request.previousLock &&
            JSON.stringify(request.previousLock) !== JSON.stringify(previous)
          )
            throw Error('기존 고정 의존성 정보를 바꿀 수 없습니다.');
          request = { ...request, previousLock: structuredClone(previous) };
        }
      }
      response = await ports.engine.execute(request, controller.signal);
      check();
      if (
        previous &&
        !ports.allowedUpgrades?.length &&
        response.action === 'prepared' &&
        JSON.stringify(response.lock) !== JSON.stringify(previous)
      )
        throw Error('기존 게임의 고정 라이브러리 버전을 유지해야 합니다.');
      if (response.action === 'prepared') prepared = response;
    }
    throw Error('라이브러리 준비 교환 한도 3회를 초과했습니다.');
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    controller.abort();
    await ports.exchange.close();
  }
}
