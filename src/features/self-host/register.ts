import { app, clipboard, shell, type BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { ProjectLibrary } from '../../project-library';
import { SelfHostService } from './service';
import { SelfHostLifecycle } from './lifecycle';
import type { SelfHostState } from './types';

/** The only main-process registration point; callers retain collaboration itself. */
export async function registerSelfHost(options: {
  developmentRoot: string;
  library: ProjectLibrary;
  activeProject: () => string | undefined;
  window: () => BrowserWindow | null;
  updatePrepared: () => boolean;
  register: (
    channel: string,
    listener: (
      event: Electron.IpcMainInvokeEvent,
      ...args: unknown[]
    ) => unknown,
  ) => void;
}) {
  const service = new SelfHostService({
    directory: path.join(
      process.env.LOCALAPPDATA ?? app.getPath('userData'),
      'GameCanvas-InternetHost',
    ),
    runtimeSource: app.isPackaged
      ? path.join(process.resourcesPath, 'self-host-runtime')
      : path.join(options.developmentRoot, 'out/self-host-runtime'),
    library: options.library,
    activeProject: options.activeProject,
    changed: (state) => {
      const window = options.window();
      if (window && !window.isDestroyed())
        window.webContents.send('self-host:changed', state);
    },
    appVersion: app.getVersion(),
    appPath: app.getAppPath(),
  });
  await service.init();
  const lifecycle = new SelfHostLifecycle(
    service,
    app.isPackaged
      ? path.join(process.resourcesPath, 'icon.ico')
      : path.join(options.developmentRoot, 'assets/icon.ico'),
    options.updatePrepared,
  );
  const handle = (
    channel: string,
    listener: (...args: unknown[]) => unknown,
  ) => {
    options.register(channel, (event, ...args) => {
      const window = options.window();
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error('앱의 서버 관리 화면에서 실행해주세요.');
      return listener(...args);
    });
  };
  handle('self-host:get', () => service.run('check'));
  handle('self-host:run', (action) =>
    service.run(action as Parameters<typeof service.run>[0]),
  );
  handle('self-host:close-behavior', (value) =>
    service.setCloseBehavior(value as SelfHostState['closeBehavior']),
  );
  handle('self-host:copy', async (id, kind) =>
    clipboard.writeText(
      await service.info(id as string, kind as 'connection' | 'invite'),
    ),
  );
  handle('self-host:prompt', () => service.prompt());
  handle('self-host:reveal', async () => {
    await fs.mkdir(service.state.dataDirectory, { recursive: true });
    if (await shell.openPath(service.state.dataDirectory))
      throw new Error('데이터 폴더를 열지 못했습니다.');
  });
  return { service, lifecycle };
}
