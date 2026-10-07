import { app, safeStorage, shell, clipboard } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { WebViewerService } from '../../src/web-viewer-service.ts';
import { ProjectLibrary } from '../../src/project-library.ts';
import { WEB_VIEWER_URL } from '../../src/web-viewer.ts';

// Separate, windowless process. The normal desktop app and its sessions stay open.
async function start() {
  const libraryDirectory = path.join(app.getPath('appData'), 'Game Canvas');
  mkdirSync(path.join(libraryDirectory, 'web-viewer-worker'), {
    recursive: true,
  });
  // Windows safeStorage uses an OS-protected Chromium key in Local State. Reuse only
  // that encrypted key in the isolated, windowless profile; never copy cookies/sessions.
  const originalState = JSON.parse(
    readFileSync(path.join(libraryDirectory, 'Local State'), 'utf8'),
  );
  const workerStatePath = path.join(
    libraryDirectory,
    'web-viewer-worker',
    'Local State',
  );
  let workerState: Record<string, unknown> = {};
  try {
    workerState = JSON.parse(readFileSync(workerStatePath, 'utf8'));
  } catch {
    /* new profile */
  }
  workerState.os_crypt = originalState.os_crypt;
  writeFileSync(workerStatePath, JSON.stringify(workerState));
  const launching =
    process.argv.includes('--open') || process.argv.includes('--copy-code');
  app.setPath('userData', path.join(libraryDirectory, 'web-viewer-worker'));
  if (launching) {
    await app.whenReady();
    const settings = await new WebViewerService(
      libraryDirectory,
      safeStorage,
    ).settings();
    if (!settings) throw new Error('Not configured');
    if (process.argv.includes('--copy-code'))
      clipboard.writeText(settings.accessCode);
    else
      await shell.openExternal(
        `${WEB_VIEWER_URL}/#connect=${encodeURIComponent(settings.accessCode)}`,
      );
    app.quit();
    return;
  }
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  await app.whenReady();
  const service = new WebViewerService(libraryDirectory, safeStorage);
  const setupFile = process.env.GAME_JAM_WEB_VIEWER_SETUP;
  delete process.env.GAME_JAM_WEB_VIEWER_SETUP;
  if (setupFile) {
    const settings = JSON.parse(await fs.readFile(setupFile, 'utf8'));
    const library = new ProjectLibrary(libraryDirectory, safeStorage);
    await library.load();
    if (settings.projects === 'all')
      settings.projects = library.list().map((entry) => entry.id);
    await service.save(settings);
    await fs.unlink(setupFile);
  }
  let stopping = false;
  const tick = async () => {
    try {
      await service.publish(!!setupFile || process.argv.includes('--publish'));
    } catch {
      /* Status available in the desktop app; no private logs. */
    }
    if (!stopping) setTimeout(() => void loop(), 15_000);
  };
  const loop = async () => {
    try {
      await service.publish();
    } catch {
      /* retry on the next tick */
    }
    if (!stopping) setTimeout(() => void loop(), 15_000);
  };
  await tick();
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      stopping = true;
      app.quit();
    });
}
void start().catch((error) => {
  console.error(
    'Web viewer publisher could not start:',
    error?.name,
    error?.code ?? '',
    ...String(error?.stack ?? '')
      .split('\n')
      .slice(1),
  );
  app.quit();
});
