import { BrowserWindow, ipcMain } from 'electron';
import type { CollaborationCredentials } from '../collaboration-client.ts';
import { createHash, randomUUID } from 'node:crypto';
import { PlayClient } from './client.ts';
import { withMultiplayerSdk } from './sdk.ts';
import { installPlayerShell } from './player-shell.js';
import { installPreviewPermissions } from '../preview-permissions.ts';
import { jsonPayload } from './contract.ts';
import type { PlayAction, PlayArtifact, PlayMessage } from './types.ts';

export function registerMultiplayerWindows(options: {
  preload: string;
  credentials: () => CollaborationCredentials | undefined;
  memberId: () => string | undefined;
  isMainSender: (event: Electron.IpcMainInvokeEvent) => boolean;
  currentHtml: (path: string) => string | undefined;
}) {
  const entries = new Map<
    number,
    {
      window: BrowserWindow;
      client: PlayClient;
      artifact: PlayArtifact;
      bridgeId: string;
      connected: boolean;
    }
  >();
  const entryFor = (
    event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
  ) => {
    const entry = entries.get(event.sender.id);
    if (
      !entry ||
      event.senderFrame !== event.sender.mainFrame ||
      options.credentials() !== entry.client.credentials
    )
      throw Error('[GC-MP-003] 현재 플레이 창에서만 사용할 수 있습니다.');
    return entry;
  };
  const credentials = () => {
    const value = options.credentials();
    if (!value) throw Error('[GC-MP-003] 공동 프로젝트에 연결해주세요.');
    return value;
  };
  ipcMain.handle('multiplayer:control', (event, input: PlayAction) => {
    if (!options.isMainSender(event))
      throw Error('앱에서만 플레이 방을 관리할 수 있습니다.');
    jsonPayload(input, 4096);
    if (input.action === 'create') {
      const html = options.currentHtml(input.path ?? '');
      if (!html) throw Error('HTML 결과를 찾을 수 없습니다.');
      input = {
        ...input,
        sourceHash: createHash('sha256').update(html).digest('hex'),
      };
    }
    return PlayClient.control(credentials(), {
      ...input,
      requestId: input.requestId ?? randomUUID(),
    });
  });
  async function open(roomId: string) {
    const auth = credentials();
    for (const entry of entries.values())
      if (
        entry.client.room.id === roomId &&
        entry.client.credentials === auth
      ) {
        entry.window.show();
        entry.window.focus();
        return;
      }
    const { room } = await PlayClient.control(auth, {
      action: 'join',
      roomId,
      requestId: randomUUID(),
    });
    if (!room) throw Error('플레이 방을 찾을 수 없습니다.');
    const { artifact } = await PlayClient.control(auth, {
      action: 'artifact',
      roomId,
    });
    if (
      !artifact ||
      artifact.sourceHash !== room.sourceHash ||
      createHash('sha256').update(artifact.html).digest('hex') !==
        room.sourceHash
    )
      throw Error('플레이 소스 해시가 일치하지 않습니다.');
    const window = new BrowserWindow({
      width: 1100,
      height: 800,
      minWidth: 720,
      minHeight: 500,
      title: 'Game Jam! · 함께 플레이',
      webPreferences: {
        preload: options.preload,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: room.hostId !== options.memberId(),
        partition: `gamejam-play-${randomUUID()}`,
      },
    });
    window.setMenu(null);
    installPreviewPermissions(window);
    const contents = window.webContents;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.on('will-frame-navigate', (event) => {
      if (!['about:blank', 'about:srcdoc'].includes(event.url))
        event.preventDefault();
    });
    contents.session.webRequest.onBeforeRequest((details, done) =>
      done({
        cancel: !['data:', 'blob:', 'about:'].some((prefix) =>
          details.url.startsWith(prefix),
        ),
      }),
    );
    const client = new PlayClient(auth, room, (message) => {
      if (!contents.isDestroyed()) contents.send('multiplayer:event', message);
    });
    const entry = {
      window,
      client,
      artifact,
      bridgeId: randomUUID(),
      connected: false,
    };
    entries.set(contents.id, entry);
    window.on('closed', () => {
      entries.delete(contents.id);
      client.close();
      void PlayClient.control(auth, {
        action: 'leave',
        roomId,
        requestId: randomUUID(),
      }).catch(() => {});
    });
    const csp =
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; frame-src about:; connect-src 'none'; form-action 'none';";
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>body{margin:0;background:#141821;color:#edf1fa;font:14px system-ui}header{padding:12px 16px;display:flex;gap:12px;align-items:center}h1{font-size:16px;margin:0;flex:1}button{padding:8px 16px;border:0;border-radius:6px}button:disabled{opacity:.5}p{margin:4px 16px 10px}iframe{width:100%;height:calc(100vh - 128px);border:0;background:#080b12}</style></head><body><header><h1 id="title">함께 플레이</h1><button id="ready" disabled>준비</button><button id="start" disabled>게임 시작</button></header><p id="members"></p><p id="status" role="status">게임을 준비하고 있습니다.</p><iframe sandbox="allow-scripts allow-pointer-lock" title="함께 플레이 게임"></iframe><script>(${installPlayerShell.toString()})();</script></body></html>`;
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    );
  }
  ipcMain.handle('multiplayer:open', (event, roomId: string) => {
    if (!options.isMainSender(event) || typeof roomId !== 'string')
      throw Error('앱에서 방을 선택해주세요.');
    return open(roomId);
  });
  ipcMain.handle('multiplayer:bootstrap', (event) => {
    const entry = entryFor(event);
    return {
      room: entry.client.room,
      memberId: options.memberId(),
      bridgeId: entry.bridgeId,
      html: withMultiplayerSdk(entry.artifact.html, 'online', entry.bridgeId),
    };
  });
  ipcMain.handle('multiplayer:player-control', (event, raw: PlayAction) => {
    const entry = entryFor(event);
    jsonPayload(raw, 4096);
    if (!['ready', 'start'].includes(raw.action))
      throw Error('허용되지 않는 플레이 조작입니다.');
    return PlayClient.control(entry.client.credentials, {
      action: raw.action,
      ready: raw.ready,
      expectedRevision: raw.expectedRevision,
      roomId: entry.client.room.id,
      requestId: randomUUID(),
    });
  });
  ipcMain.on('multiplayer:connect', (event) => {
    try {
      const entry = entryFor(event);
      if (!entry.connected) {
        entry.connected = true;
        entry.client.connect();
      }
    } catch {
      /* Untrusted frames are ignored. */
    }
  });
  ipcMain.on('multiplayer:send', (event, message: PlayMessage) => {
    let entry: ReturnType<typeof entryFor>;
    try {
      entry = entryFor(event);
    } catch {
      return;
    }
    try {
      entry.client.send(message);
    } catch (error) {
      const reason = String((error as Error).message).slice(0, 300);
      event.sender.send('multiplayer:event', {
        type: 'error',
        message: reason,
      });
      entry.client.send({ type: 'error', message: reason });
    }
  });
  const timer = setInterval(() => {
    for (const entry of entries.values())
      if (options.credentials() !== entry.client.credentials)
        entry.window.close();
  }, 500);
  timer.unref();
  return {
    open,
    close() {
      clearInterval(timer);
      for (const entry of entries.values()) entry.window.close();
    },
  };
}
