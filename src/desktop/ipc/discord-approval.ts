import { shell, type ipcMain } from 'electron';
import { discordHelpUrl } from '../../discord-approval-help';
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
  options.register('discord-approval:help', async (event, page: unknown) => {
    if (!options.isSender(event))
      throw Error('앱의 설정 도움말에서 열어주세요.');
    await shell.openExternal(discordHelpUrl(page));
  });
  for (const operation of [
    'status',
    'configure',
    'disconnect',
    'test',
  ] as const) {
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
          if (operation === 'test') return service.sendTest();
          return service.configure(input);
        });
      options.setQueue(action);
      return action;
    });
  }
}
