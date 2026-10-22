import { app, BrowserWindow, clipboard, ipcMain } from 'electron';
import type { CollaborationCredentials } from '../collaboration-client.ts';
import path from 'node:path';
import { PlayDiagnostics, diagnosticRef } from './diagnostics.ts';
import { PlayError, PLAY_ERRORS, type PlayErrorCode } from './errors.ts';
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
  currentHtml: (
    path: string,
  ) => string | undefined | Promise<string | undefined>;
}) {
  const diagnostics = new PlayDiagnostics(
    path.join(app.getPath('userData'), 'multiplayer-diagnostics.json'),
    app.getVersion(),
  );
  const previews = new Map<number, number>();
  const detailsFor = (
    room?: import('./types.ts').PlayRoom,
    operation?: string,
  ) => ({
    side: 'main',
    operation,
    projectRef: diagnosticRef(options.credentials()?.projectId),
    roomRef: diagnosticRef(room?.id),
    sessionRef: diagnosticRef(room?.serverEpoch),
    matchRef: diagnosticRef(room?.matchId ?? undefined),
    sourceHash: room?.sourceHash,
    roomStatus: room?.status,
  });
  const capture = (
    error: unknown,
    code: PlayErrorCode = 'GC-MP-029',
    room?: import('./types.ts').PlayRoom,
    operation?: string,
  ) => diagnostics.record(error, code, detailsFor(room, operation));
  const handle = (
    channel: string,
    action: (event: Electron.IpcMainInvokeEvent, input: any) => unknown,
  ) =>
    ipcMain.handle(channel, async (event, input) => {
      try {
        return await action(event, input);
      } catch (error) {
        return { playFailure: capture(error) };
      }
    });
  const entries = new Map<
    number,
    {
      window: BrowserWindow;
      client: PlayClient;
      artifact: PlayArtifact;
      bridgeId: string;
      connected: boolean;
      loaded: boolean;
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
      throw new PlayError('GC-MP-026');
    return entry;
  };
  const credentials = () => {
    const value = options.credentials();
    if (!value) throw new PlayError('GC-MP-003');
    return value;
  };
  handle('multiplayer:control', async (event, input: PlayAction) => {
    if (!options.isMainSender(event)) throw new PlayError('GC-MP-026');
    const auth = credentials();
    jsonPayload(input, 4096);
    if (input.action === 'create') {
      const html = await options.currentHtml(input.path ?? '');
      if (!html) throw new PlayError('GC-MP-001');
      input = {
        ...input,
        sourceHash: createHash('sha256').update(html).digest('hex'),
      };
    }
    if (options.credentials() !== auth) throw new PlayError('GC-MP-003');
    const result = await PlayClient.control(auth, {
      ...input,
      requestId: input.requestId ?? randomUUID(),
    });
    if (options.credentials() !== auth) throw new PlayError('GC-MP-003');
    return result;
  });
  handle('multiplayer:status', async (event) => {
    if (!options.isMainSender(event)) throw new PlayError('GC-MP-026');
    return PlayClient.status(credentials());
  });
  async function open(roomId: string) {
    const auth = credentials();
    await PlayClient.status(auth);
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
    if (!room) throw new PlayError('GC-MP-009');
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
      throw new PlayError('GC-MP-012');
    if (options.credentials() !== auth) throw new PlayError('GC-MP-003');
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
    let blockedResource = false;
    contents.session.webRequest.onBeforeRequest((details, done) => {
      const cancel = !['data:', 'blob:', 'about:'].some((prefix) =>
        details.url.startsWith(prefix),
      );
      done({ cancel });
      if (cancel && !blockedResource) {
        blockedResource = true;
        const failure = capture(
          new PlayError('GC-MP-027', { resourceType: details.resourceType }),
          'GC-MP-027',
          room,
          'runtime',
        );
        contents.send('multiplayer:event', {
          type: 'error',
          code: failure.code,
          message: failure.message,
          failure,
        });
        try {
          client.send({ type: 'error', code: failure.code, failure });
        } catch {
          /* No URL or request contents are recorded. */
        }
      }
    });
    const client = new PlayClient(auth, room, (message) => {
      const problem =
        message.failure ??
        (message.type === 'room'
          ? (message.room as import('./types.ts').PlayRoom)?.failure
          : undefined);
      if (problem) {
        const failure = capture(problem, 'GC-MP-029', client.room, 'receive');
        if (message.type !== 'room')
          message = {
            ...message,
            failure,
            code: failure.code,
            message: failure.message,
          };
      }
      if (!contents.isDestroyed()) contents.send('multiplayer:event', message);
    });
    const entry = {
      window,
      client,
      artifact,
      bridgeId: randomUUID(),
      connected: false,
      loaded: false,
    };
    entries.set(contents.id, entry);
    const loadTimer = setTimeout(() => {
      if (
        entry.loaded ||
        window.isDestroyed() ||
        ['finished', 'closed'].includes(client.room.status)
      )
        return;
      const failure = capture(
        new PlayError('GC-MP-013'),
        'GC-MP-013',
        client.room,
        'open',
      );
      contents.send('multiplayer:event', {
        type: 'error',
        code: failure.code,
        message: failure.message,
        failure,
      });
      try {
        client.send({ type: 'error', code: failure.code, failure });
      } catch {
        /* Failure is already recorded locally. */
      }
    }, 13000);
    loadTimer.unref();
    contents.on('render-process-gone', () => {
      const failure = capture(
        new PlayError('GC-MP-025'),
        'GC-MP-025',
        client.room,
        'runtime',
      );
      try {
        client.send({ type: 'error', code: failure.code, failure });
      } catch {
        /* Connection may have already closed. */
      }
    });
    window.on('closed', () => {
      entries.delete(contents.id);
      clearTimeout(loadTimer);
      void diagnostics.flush();
      client.close();
      void PlayClient.control(auth, {
        action: 'leave',
        roomId,
        requestId: randomUUID(),
      }).catch(() => {});
    });
    const csp =
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; frame-src about:; connect-src 'none'; form-action 'none';";
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>body{margin:0;height:100vh;display:flex;flex-direction:column;overflow:hidden;background:#141821;color:#edf1fa;font:14px system-ui}header{padding:12px 16px;display:flex;gap:12px;align-items:center}h1{font-size:16px;margin:0;flex:1}button{padding:8px 16px;border:0;border-radius:6px}button:disabled{opacity:.5}p{margin:4px 16px 10px}#failure{flex-shrink:0;max-height:42vh;overflow:auto}header,p{flex-shrink:0}iframe{width:100%;flex:1;min-height:140px;border:0;background:#080b12}</style></head><body><header><h1 id="title">함께 플레이</h1><button id="ready" disabled>준비</button><button id="start" disabled>게임 시작</button></header><p id="members"></p><p id="status" role="status">게임을 준비하고 있습니다.</p><section id="failure" hidden style="margin:8px 16px;padding:12px;border:1px solid #e7b36c;border-radius:8px"><strong id="failure-message"></strong><p id="failure-hint"></p><small id="failure-code"></small><details><summary>오류 정보</summary><pre id="failure-detail" style="white-space:pre-wrap"></pre></details><button id="copy-diagnostics">오류 정보 복사</button><span id="copy-result" role="status"></span></section><iframe sandbox="allow-scripts allow-pointer-lock" title="함께 플레이 게임"></iframe><script>(${installPlayerShell.toString()})();</script></body></html>`;
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    );
  }
  const opening = new Map<
    string,
    { auth: CollaborationCredentials; promise: Promise<void> }
  >();
  handle('multiplayer:open', async (event, roomId: string) => {
    if (!options.isMainSender(event) || typeof roomId !== 'string')
      throw new PlayError('GC-MP-026');
    const auth = credentials();
    const key = `${auth.projectId}:${roomId}`;
    const pending = opening.get(key);
    if (pending?.auth === auth) return pending.promise;
    const promise = open(roomId);
    opening.set(key, { auth, promise });
    try {
      return await promise;
    } finally {
      if (opening.get(key)?.promise === promise) opening.delete(key);
    }
  });
  handle('multiplayer:bootstrap', (event) => {
    const entry = entryFor(event);
    return {
      room: entry.client.room,
      errors: PLAY_ERRORS,
      memberId: options.memberId(),
      bridgeId: entry.bridgeId,
      html: withMultiplayerSdk(entry.artifact.html, 'online', entry.bridgeId),
    };
  });
  handle('multiplayer:player-control', (event, raw: PlayAction) => {
    const entry = entryFor(event);
    jsonPayload(raw, 4096);
    if (!['ready', 'start'].includes(raw.action))
      throw new PlayError('GC-MP-026');
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
      if (message.type === 'loaded') entry.loaded = true;
      if (message.type === 'error') {
        const failure = capture(
          { code: message.code, details: message.diagnostic },
          'GC-MP-025',
          entry.client.room,
          'runtime',
        );
        event.sender.send('multiplayer:event', {
          type: 'error',
          code: failure.code,
          message: failure.message,
          failure,
        });
        message = {
          type: 'error',
          code: failure.code,
          failure,
          diagnostic: failure.details,
        };
      }
      entry.client.send(message);
    } catch (error) {
      const failure = capture(error, 'GC-MP-020', entry.client.room, 'send');
      event.sender.send('multiplayer:event', {
        type: 'error',
        code: failure.code,
        message: failure.message,
        failure,
      });
      try {
        entry.client.send({ type: 'error', code: failure.code, failure });
      } catch {
        /* The original diagnostic is preserved if the socket is unavailable. */
      }
    }
  });
  handle('multiplayer:diagnostics', async (event, copy: unknown) => {
    let scope;
    if (options.isMainSender(event))
      scope = options.credentials()
        ? { projectRef: diagnosticRef(options.credentials()?.projectId) }
        : { side: 'preview' };
    else scope = { roomRef: diagnosticRef(entryFor(event).client.room.id) };
    const report = await diagnostics.report(scope);
    const text = JSON.stringify(report, null, 2);
    if (copy === true) await clipboard.writeText(text);
    return {
      report: text,
      count: report.count,
      storageAvailable: report.storageAvailable,
    };
  });
  handle('multiplayer:report-preview', async (event, input: unknown) => {
    if (!options.isMainSender(event)) throw new PlayError('GC-MP-026');
    const now = Date.now();
    if (now - (previews.get(event.sender.id) ?? 0) < 1000) return;
    if (!previews.has(event.sender.id))
      event.sender.once('destroyed', () => previews.delete(event.sender.id));
    previews.set(event.sender.id, now);
    const value = input as {
      path: string;
      diagnostic: { code?: unknown; diagnostic?: unknown };
    };
    jsonPayload(value, 4096);
    const html = await options.currentHtml(value.path);
    if (!html || !value.diagnostic) return;
    return diagnostics.record(
      { code: value.diagnostic.code, details: value.diagnostic.diagnostic },
      'GC-MP-025',
      {
        side: 'preview',
        operation: 'preview',
        projectRef: diagnosticRef(options.credentials()?.projectId),
        sourceHash: createHash('sha256').update(html).digest('hex'),
      },
    );
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
