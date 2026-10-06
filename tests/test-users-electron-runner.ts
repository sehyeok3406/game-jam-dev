import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app, safeStorage, nativeImage } from 'electron';
import { CollaborationClient } from '../src/collaboration-client';
import { createCollaborationServer } from '../src/collaboration-server';
import {
  TestUserLauncher,
  testProfilePath,
  TEST_PROFILE_FLAG,
} from '../src/test-users';

async function run() {
  await app.whenReady();
  assert.equal(safeStorage.isEncryptionAvailable(), true);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-real-users-'));
  const previous = process.env.GAME_CANVAS_INTEGRATION_USER_DATA;
  const previousImports = process.env.GAME_CANVAS_IMPORT_TEST_FILES_DIR;
  process.env.GAME_CANVAS_INTEGRATION_USER_DATA = root;
  const fixtureRoot = path.join(root, 'import-fixtures');
  await fs.mkdir(fixtureRoot);
  const png = nativeImage
    .createFromBitmap(Buffer.from([0, 128, 255, 255]), { width: 1, height: 1 })
    .toPNG();
  assert.ok(png.length);
  await fs.writeFile(path.join(fixtureRoot, 'player.png'), png);
  await fs.writeFile(
    path.join(fixtureRoot, 'player.jpg'),
    nativeImage.createFromBuffer(png).toJPEG(90),
  );
  await fs.writeFile(
    path.join(fixtureRoot, 'player.gif'),
    Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'base64',
    ),
  );
  await fs.writeFile(
    path.join(fixtureRoot, 'player.webp'),
    Buffer.from(
      'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA',
      'base64',
    ),
  );
  await fs.writeFile(
    path.join(fixtureRoot, 'reference.md'),
    '# 外部 문서\n\n|체력|속도|\n|---|---|\n|100|2|',
  );
  process.env.GAME_CANVAS_IMPORT_TEST_FILES_DIR = fixtureRoot;
  const htmlFixture =
    '<!doctype html><html><body><canvas></canvas><button>Play</button><script>let score=0;</script></body></html>';
  await fs.writeFile(path.join(fixtureRoot, 'game.html'), htmlFixture);
  const server = await createCollaborationServer({
    port: 0,
    dataDirectory: path.join(root, 'server'),
    creationKey: 'fixture',
  });
  try {
    const created = await CollaborationClient.create(
      `http://127.0.0.1:${server.port}`,
      'fixture',
      '관리자',
      '실제 멀티 프로세스',
      {
        'project.md':
          '---\nid: project\ntitle: 테스트\ntype: overview\nstatus: draft\nsources: []\n---\n# 테스트',
      },
    );
    const owner = new CollaborationClient(created.credentials, () => {});
    owner.accept(created.result);
    await fs.writeFile(
      path.join(root, 'settings.json'),
      'original admin settings',
    );
    const launcher = new TestUserLauncher({
      base: root,
      executable: process.execPath,
      packaged: false,
      appPath: path.resolve('out/test-validation/test-user-worker.cjs'),
    });
    const editors = await launcher.launch(owner, {
      count: 3,
      nicknamePrefix: '편집 테스트',
      role: 'editor',
    });
    const all = await launcher.launch(owner, {
      count: 1,
      nicknamePrefix: '뷰어 테스트',
      role: 'viewer',
    });
    assert.equal(editors.length, 3);
    assert.equal(all.length, 4);
    for (let i = 0; i < 400; i++) {
      const statuses = await launcher.list(owner.credentials.projectId);
      if (
        statuses.every(
          (item) => item.status === 'closed' || item.status === 'failed',
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const reports = [];
    for (const item of await launcher.list(owner.credentials.projectId)) {
      const profile = testProfilePath(root, [
        `${TEST_PROFILE_FLAG}${item.id}`,
      ])!;
      if (item.status !== 'closed') {
        const message = await fs
          .readFile(path.join(profile, 'fixture-error.txt'), 'utf8')
          .catch(() => item.message ?? item.status);
        const startup = await fs
          .readFile(path.join(profile, 'fixture-startup-errors.txt'), 'utf8')
          .catch(() => '');
        throw new Error(message + '\n' + startup);
      }
      const report = JSON.parse(
        await fs.readFile(path.join(profile, 'fixture-report.json'), 'utf8'),
      );
      assert.equal(report.userData, profile);
      assert.equal(report.sessionData, profile);
      assert.ok(report.workspace.startsWith(profile));
      assert.equal(report.memberId, item.memberId);
      assert.equal(report.windowVisible, true);
      reports.push(report);
    }
    assert.equal(new Set(reports.map((r) => r.userData)).size, 4);
    assert.equal(new Set(reports.map((r) => r.memberId)).size, 4);
    await owner.refresh();
    for (const report of reports.filter((r) => r.role === 'editor')) {
      assert.ok(owner.files[report.relativePath].includes(report.nickname));
      assert.equal(
        owner.files[report.importedImagePath],
        `data:image/png;base64,${png.toString('base64')}`,
      );
      assert.equal(owner.files[report.importedHtmlPath], htmlFixture);
    }
    assert.equal(reports.filter((r) => r.role === 'viewer').length, 1);
    assert.equal(
      await fs.readFile(path.join(root, 'settings.json'), 'utf8'),
      'original admin settings',
    );
    console.log(
      'PASS: four actual visible native windows finish loading before ready, restore isolated sessions, three editors import HTML/PNG/JPEG/GIF/WebP/Markdown; viewers cannot import or recursively launch tests',
    );
  } finally {
    if (previous === undefined)
      delete process.env.GAME_CANVAS_INTEGRATION_USER_DATA;
    else process.env.GAME_CANVAS_INTEGRATION_USER_DATA = previous;
    if (previousImports === undefined)
      delete process.env.GAME_CANVAS_IMPORT_TEST_FILES_DIR;
    else process.env.GAME_CANVAS_IMPORT_TEST_FILES_DIR = previousImports;
    await server.close();
    await fs
      .rm(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
      })
      .catch(() => console.error('Test fixtures retained:', root));
  }
}
run()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
