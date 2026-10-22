import { backupEnvironment } from './server/operations/backup-config.ts';
import { createCollaborationServer } from './collaboration-server.ts';
import { serverEnvironment } from './server/config.ts';

const config = serverEnvironment();
const scheduledBackup = backupEnvironment(config.dataDirectory);
const starting = createCollaborationServer({
  ...config,
  backup: scheduledBackup,
  requestLog: (entry) => console.log(JSON.stringify(entry)),
});
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => {
      console.error('서버 종료 상한 초과');
      process.exit(1);
    }, config.shutdownMs);
    void starting
      .then((running) => running.close())
      .then(
        () => {
          clearTimeout(deadline);
          process.exit(0);
        },
        () => {
          clearTimeout(deadline);
          console.error('서버 종료 정리 실패');
          process.exit(1);
        },
      );
  });
}
const running = await starting;
if (!stopping) {
  console.log(`Game Canvas 협업 서버 · ${config.host}:${running.port}`);
  console.log(
    '데스크톱 앱의 협업 패널에서 서버 주소를 입력하세요. 인터넷 운영 시 HTTPS 역방향 프록시를 사용하세요.',
  );
}
