import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  app,
  safeStorage,
  testHandlers,
  BrowserWindow,
} from './multi-user-electron';
import { TEST_BOOTSTRAP_KEY_ENV } from '../src/test-users';

app.setPath('userData', process.env.GAME_CANVAS_INTEGRATION_USER_DATA!);
const originalError = console.error;
console.error = (...values: unknown[]) => {
  originalError(...values);
  void fs.appendFile(
    path.join(app.getPath('userData'), 'fixture-startup-errors.txt'),
    values
      .map((value) => (value instanceof Error ? value.stack : String(value)))
      .join(' ') + '\n',
  );
};
async function run() {
  await import('../src/main');
  const call = (channel: string, ...args: unknown[]) =>
    testHandlers.get(channel)!({}, ...args);
  for (let i = 0; i < 100; i++) {
    try {
      await fs.access(path.join(app.getPath('userData'), 'launch-status.json'));
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  const state = await call('collaboration:get');
  assert.equal(
    state.connected,
    true,
    JSON.stringify({
      active: state.active,
      message: state.message,
      server: state.serverUrl,
    }),
  );
  const test = await call('collaboration:test-users');
  const mainWindow = BrowserWindow.getAllWindows()[0];
  assert.ok(mainWindow, 'Test user must create a real native window');
  if (process.platform !== 'darwin')
    assert.equal(
      mainWindow.isMenuBarVisible(),
      false,
      'Test user windows must not show the File/Edit/View/Window menu',
    );
  assert.equal(mainWindow.isResizable(), true);
  assert.equal(mainWindow.isMinimizable(), true);
  assert.equal(mainWindow.isMaximizable(), true);
  assert.equal(
    mainWindow.isVisible(),
    true,
    'Test user joined the server, but its native window is hidden',
  );
  assert.equal(mainWindow.webContents.isLoading(), false);
  assert.equal(mainWindow.getTitle(), `Game Jam! · ${test.nickname}`);
  assert.ok(mainWindow.getNativeWindowHandle().length > 0);
  const launchStatus = JSON.parse(
    await fs.readFile(
      path.join(app.getPath('userData'), 'launch-status.json'),
      'utf8',
    ),
  );
  assert.equal(launchStatus.status, 'ready');
  assert.equal(launchStatus.windowVisible, true);
  assert.equal(test.isTestUser, true);
  assert.ok(test.nickname);
  assert.equal(process.env[TEST_BOOTSTRAP_KEY_ENV], undefined);
  await assert.rejects(
    fs.access(path.join(app.getPath('userData'), 'bootstrap.enc')),
    { code: 'ENOENT' },
  );
  const session = JSON.parse(
    safeStorage.decryptString(
      await fs.readFile(
        path.join(app.getPath('userData'), 'collaboration-session.enc'),
      ),
    ),
  );
  assert.ok(session.credentials.token);
  assert.equal(session.credentials.inviteCode, undefined);
  assert.equal(session.credentials.recoveryKey, undefined);
  await assert.rejects(
    call('collaboration:launch-test-users', {
      count: 1,
      nicknamePrefix: '재귀 실행',
      role: 'editor',
    }),
    /원래 관리자 창/,
  );
  let relativePath: string | undefined;
  let importedImagePath: string | undefined;
  let importedHtmlPath: string | undefined;
  if (state.role === 'editor') {
    const idea = await call('documents:create-idea', { x: 100, y: 100 });
    relativePath = idea.relativePath;
    const authorship = await call('files:authorship', relativePath);
    assert.equal(authorship.createdBy.id, state.memberId);
    assert.equal(authorship.createdBy.name, test.nickname);
    await call('collaboration:lock', relativePath);
    await call('documents:save', {
      relativePath,
      title: test.nickname,
      body: `${test.nickname} 실제 프로세스 편집`,
    });
    await call('collaboration:unlock', relativePath);
    const imported = await call('files:import', {
      x: 300,
      y: 100,
      imagePurpose: 'asset',
    });
    assert.equal(imported.length, 6);
    importedHtmlPath = imported.find((doc: any) => doc.htmlSource)?.htmlSource;
    assert.ok(importedHtmlPath);
    assert.ok(
      (await call('preview:read', importedHtmlPath)).content.includes(
        '<canvas>',
      ),
    );
    assert.equal(
      (await call('files:authorship', importedHtmlPath)).createdBy.id,
      state.memberId,
    );
    const image = imported.find((doc: any) => doc.asset?.mime === 'image/png');
    for (const card of imported.filter((doc: any) => doc.type === 'image')) {
      assert.ok(
        (await call('assets:read', card.asset.path)).startsWith(
          `data:${card.asset.mime};base64,`,
        ),
      );
    }
    assert.ok(image.asset);
    importedImagePath = image.asset.path;
    assert.ok(
      (await call('assets:read', importedImagePath)).startsWith(
        'data:image/png;base64,',
      ),
    );
    assert.ok(
      (await call('documents:list')).find((doc: any) => doc.id === image.id)
        .assetVersion,
    );
  } else {
    assert.equal(state.role, 'viewer');
    await assert.rejects(
      call('documents:create-idea', { x: 100, y: 100 }),
      /뷰어|권한/,
    );
    await assert.rejects(
      call('files:import', { x: 300, y: 100, imagePurpose: 'asset' }),
      /관리자·편집자/,
    );
  }
  await fs.writeFile(
    path.join(app.getPath('userData'), 'fixture-report.json'),
    JSON.stringify({
      userData: app.getPath('userData'),
      sessionData: app.getPath('sessionData'),
      memberId: state.memberId,
      role: state.role,
      nickname: test.nickname,
      relativePath,
      importedImagePath,
      importedHtmlPath,
      workspace: (await call('workspace:get')).root,
      title: app.getName(),
      windowVisible: mainWindow.isVisible(),
    }),
  );
  await call('collaboration:leave');
  await new Promise((resolve) => setTimeout(resolve, 250));
  app.quit();
}
run().catch(async (error) => {
  await fs
    .writeFile(
      path.join(app.getPath('userData'), 'fixture-error.txt'),
      error instanceof Error ? (error.stack ?? String(error)) : String(error),
    )
    .catch(() => undefined);
  app.exit(1);
});
