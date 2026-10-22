import path from 'node:path';
import { isIP } from 'node:net';

export type ServiceMode = 'self-host' | 'managed-beta' | 'managed';
export function assertServiceMode(mode: string, creationKey?: string) {
  if (!['self-host', 'managed-beta', 'managed'].includes(mode))
    throw new Error('GAMEJAM_SERVICE_MODE가 올바르지 않습니다.');
  if (mode === 'managed')
    throw new Error(
      'managed 모드는 F01 인증·권한 구현 전에는 사용할 수 없습니다.',
    );
  if (mode === 'managed-beta' && (creationKey?.length ?? 0) < 32)
    throw new Error('managed-beta에는 32자 이상의 서버 생성 키가 필요합니다.');
}
export function serverEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const rawPort = env.GAME_CANVAS_PORT ?? env.PORT ?? '4317';
  if (!/^\d+$/.test(rawPort) || +rawPort < 1 || +rawPort > 65535)
    throw new Error('서버 포트가 올바르지 않습니다.');
  const host = env.GAME_CANVAS_HOST ?? '127.0.0.1';
  if (!host || (!isIP(host) && host !== 'localhost'))
    throw new Error('서버 host는 IP 주소 또는 localhost여야 합니다.');
  const mode = env.GAMEJAM_SERVICE_MODE ?? 'self-host';
  assertServiceMode(mode, env.GAME_CANVAS_SERVER_KEY);
  if (env.GAME_CANVAS_PUBLIC && !['0', '1'].includes(env.GAME_CANVAS_PUBLIC))
    throw new Error('GAME_CANVAS_PUBLIC은 0 또는 1이어야 합니다.');
  const timeout = env.GAMEJAM_SHUTDOWN_MS ?? '25000';
  if (!/^\d+$/.test(timeout) || +timeout < 1000 || +timeout > 25000)
    throw new Error('GAMEJAM_SHUTDOWN_MS는 1000~25000이어야 합니다.');
  return {
    host,
    port: +rawPort,
    dataDirectory: path.resolve(env.GAME_CANVAS_DATA ?? 'collaboration-data'),
    creationKey: env.GAME_CANVAS_SERVER_KEY,
    publicAccess: env.GAME_CANVAS_PUBLIC === '1',
    serviceMode: mode as ServiceMode,
    trustedProxies: (env.GAMEJAM_TRUSTED_PROXIES ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    shutdownMs: +timeout,
  };
}
