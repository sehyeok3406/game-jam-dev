import type { ipcMain } from 'electron';
import type { DiscordApprovalService } from '../../discord-approval';

type DiscordIpc = {
  register: (
    channel: string,
    listener: Parameters<typeof ipcMain.handle>[1],
  ) => void;
  isSender: (event: Electron.IpcMainInvokeEvent) => boolean;
  service: () => DiscordApprovalService;
  queue: () => Promise<unknown>;
  setQueue: (queue: Promise<unknown>) => void;
  updatePrepared: () => boolean;
};

/** Never route bot tokens through the generic IPC diagnostic logger. */
export function registerDiscordApprovalIpc(options: DiscordIpc) {
  for (const operation of ['status', 'configure', 'disconnect'] as const) {
    options.register(`discord-approval:${operation}`, async (event, input) => {
      if (!options.isSender(event))
        throw Error('앱의 관리자 설정에서만 디스코드를 연결할 수 있습니다.');
      const service = options.service();
      if (operation === 'status') return service.status();
      const action = options
        .queue()
        .catch(() => undefined)
        .then(async () => {
          if (options.updatePrepared())
            throw Error('업데이트 재시작을 준비하고 있습니다.');
          if (operation === 'disconnect') return service.disconnect();
          return service.configure(input);
        });
      options.setQueue(action);
      return action;
    });
  }
}
