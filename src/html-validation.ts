import { PlayError, isPlayCode, playFailure } from './multiplayer/errors.ts';
import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import { inspectHtml } from './html-document';
import { CanvasError } from './app-errors';
import { withMultiplayerSdk } from './multiplayer/sdk';
import { readMultiplayerManifest } from './multiplayer/contract';
import { validateMultiplayerRuntime } from './multiplayer/runtime-validation';

export async function validateHtml(content: string, relativePath?: string) {
  const normalized = withMultiplayerSdk(
    inspectHtml(content, relativePath).normalized,
  );
  const validator = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: `validation-${randomUUID()}`,
    },
  });
  validator.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  validator.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  validator.webContents.session.webRequest.onBeforeRequest(
    (details, callback) =>
      callback({
        cancel:
          !details.url.startsWith('data:') && !details.url.startsWith('about:'),
      }),
  );
  const errors: {
    message: string;
    source?: string;
    line?: number;
    code?: 'GC-HTML-004';
  }[] = [];
  validator.webContents.on('console-message', (details) => {
    if (details.level === 'error')
      errors.push({
        message: details.message,
        source: details.sourceId.startsWith('data:')
          ? 'generated-html'
          : details.sourceId,
        line: details.lineNumber,
      });
  });
  validator.webContents.on('render-process-gone', (_event, details) =>
    errors.push({
      message: `HTML 실행 프로세스 종료: ${details.reason}`,
      code: 'GC-HTML-004',
    }),
  );
  const instrumentation =
    '<script>window.addEventListener("error",e=>console.error(e.message||"HTML 실행 오류"));window.addEventListener("unhandledrejection",e=>console.error(String(e.reason)));</script>';
  const instrumented = normalized.replace(
    /<head([^>]*)>/i,
    `<head$1>${instrumentation}`,
  );
  let timeout: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([
      (async () => {
        await validator.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(instrumented)}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 900));
        const gameCode = errors[0]?.message.match(/\[(GC-MP-\d{3})\]/)?.[1];
        if (isPlayCode(gameCode)) {
          const failure = playFailure({ code: gameCode }, gameCode, {
            side: 'validation',
            line: errors[0].line,
          });
          throw new CanvasError(failure.code, failure.message, failure.details);
        }
        if (errors.length)
          throw new CanvasError(
            errors[0].code ?? 'GC-HTML-002',
            `HTML 초기 실행 오류: ${errors[0].message}`,
            { relativePath, errors: errors.slice(0, 10) },
          );
        if (readMultiplayerManifest(content))
          await validateMultiplayerRuntime(validator, content);
      })(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new CanvasError(
                'GC-HTML-003',
                'HTML 초기 실행 확인 시간이 초과되었습니다.',
                { relativePath, timeoutMs: 8000 },
              ),
            ),
          8000,
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof PlayError)
      throw new CanvasError(error.code, error.message, error.details);
    if (error instanceof CanvasError) throw error;
    throw new CanvasError(
      'GC-HTML-002',
      `HTML 초기 실행 오류: ${error instanceof Error ? error.message : String(error)}`,
      { relativePath },
    );
  } finally {
    clearTimeout(timeout!);
    if (!validator.isDestroyed()) validator.destroy();
  }
}
