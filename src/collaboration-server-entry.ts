import path from 'node:path';
import { createCollaborationServer } from './collaboration-server.ts';

const host = process.env.GAME_CANVAS_HOST ?? '127.0.0.1';
const port = Number(process.env.GAME_CANVAS_PORT ?? 4317);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('서버 포트가 올바르지 않습니다.');
const running = await createCollaborationServer({
  host,
  port,
  dataDirectory:
    process.env.GAME_CANVAS_DATA ?? path.resolve('collaboration-data'),
  creationKey: process.env.GAME_CANVAS_SERVER_KEY,
  publicAccess: process.env.GAME_CANVAS_PUBLIC === '1',
});
console.log(`Game Canvas 협업 서버 · ${host}:${running.port}`);
console.log(
  '데스크톱 앱의 협업 패널에서 서버 주소를 입력하세요. 인터넷 운영 시 HTTPS 역방향 프록시를 사용하세요.',
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => void running.close().then(() => process.exit(0)));
