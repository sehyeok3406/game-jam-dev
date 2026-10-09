import { serverAddress } from './collaboration-client.ts';

export type ConnectionInfo = {
  format: 'gamejam-connection';
  version: 1;
  projectId: string;
  serverUrl: string;
};
export function connectionInfo(projectId: string, serverUrl: string): string {
  return JSON.stringify(
    {
      format: 'gamejam-connection',
      version: 1,
      projectId,
      serverUrl,
    } satisfies ConnectionInfo,
    null,
    2,
  );
}
export function parseConnectionInfo(text: string): ConnectionInfo {
  if (typeof text !== 'string' || text.length > 4096)
    throw new Error('Game Jam! 연결 정보를 붙여넣어주세요.');
  let value: ConnectionInfo;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('연결 정보 전체를 복사해 붙여넣어주세요.');
  }
  if (
    !value ||
    value.format !== 'gamejam-connection' ||
    value.version !== 1 ||
    typeof value.projectId !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(value.projectId) ||
    typeof value.serverUrl !== 'string'
  )
    throw new Error(
      '지원하지 않는 연결 정보입니다. 호스트에게 다시 복사를 요청하세요.',
    );
  const serverUrl = serverAddress(value.serverUrl);
  if (!serverUrl.startsWith('https://'))
    throw new Error('인터넷 연결 정보에는 HTTPS 서버 주소가 필요합니다.');
  return {
    format: 'gamejam-connection',
    version: 1,
    projectId: value.projectId,
    serverUrl,
  };
}
