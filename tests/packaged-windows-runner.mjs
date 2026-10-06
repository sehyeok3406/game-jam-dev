// Real packaged GUI smoke test. Only its own temporary profiles/processes
// are touched; existing administrator/test sessions are never terminated.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import {
  TestUserLauncher,
  testProfilePath,
  TEST_PROFILE_FLAG,
} from '../src/test-users.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { buildFileImports } from '../src/file-assets.ts';

assert.equal(
  process.platform,
  'win32',
  'This smoke test checks Windows GUI visibility',
);
const executable = await fs.realpath(
  path.resolve('out/Game Jam!-win32-x64/Game Canvas.exe'),
);
const base = path.join(process.env.APPDATA, 'Game Canvas');
const root = await fs.mkdtemp(
  path.join(os.tmpdir(), 'canvas-packaged-windows-'),
);
const children = [];
const profiles = [];
let server;
let owner;
try {
  server = await createCollaborationServer({
    port: 0,
    dataDirectory: root,
    creationKey: 'fixture',
  });
  const created = await CollaborationClient.create(
    `http://127.0.0.1:${server.port}`,
    'fixture',
    '패키지 검증 관리자',
    '창 표시 검증 · 임시 프로젝트',
    {
      'output/games/v1-패키지-검증/index.html':
        '<!doctype html><html><head><title>Result folder test</title></head><body><button>Play</button></body></html>',
      'project.md':
        '---\nid: project\ntitle: 창 표시 검증\ntype: overview\nstatus: draft\nsources: []\n---\n# 임시 검증 프로젝트',
      ...buildFileImports({
        x: 500,
        y: 120,
        imagePurpose: 'asset',
        files: [
          {
            name: 'packaged-game.html',
            content:
              '<!doctype html><html><body><canvas></canvas><button>Play</button></body></html>',
          },
        ],
      }),
    },
  );
  owner = new CollaborationClient(created.credentials, () => {});
  owner.accept(created.result);
  const prefix = `창 표시 검증 ${randomUUID().slice(0, 8)}`;
  const launcher = new TestUserLauncher({
    base,
    executable,
    appPath: '',
    packaged: true,
    spawn: (command, args, options) => {
      const profile = testProfilePath(base, args);
      assert.ok(profile);
      profiles.push(profile);
      const child = spawn(command, args, options);
      children.push(child);
      return child;
    },
  });
  const windows = await launcher.launch(owner, {
    count: 2,
    role: 'editor',
    nicknamePrefix: prefix,
  });
  assert.equal(windows.length, 2);
  let ready;
  for (let attempt = 0; attempt < 200; attempt++) {
    ready = await launcher.list(owner.credentials.projectId);
    if (ready.every((item) => item.status !== 'starting')) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(
    ready.every((item) => item.status === 'ready'),
    JSON.stringify(ready),
  );
  for (const [index, child] of children.entries()) {
    assert.ok(Number.isInteger(child.pid));
    const { stdout } = await promisify(execFile)(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $testWindowProcess = Get-Process -Id ${child.pid}; [pscustomobject]@{handle=$testWindowProcess.MainWindowHandle.ToInt64(); title=$testWindowProcess.MainWindowTitle} | ConvertTo-Json -Compress`,
      ],
      { windowsHide: true },
    );
    const native = JSON.parse(stdout);
    assert.ok(
      native.handle > 0,
      'Packaged application has no visible top-level window',
    );
    assert.equal(native.title, `Game Jam! · ${windows[index].nickname}`);
    const status = JSON.parse(
      await fs.readFile(
        path.join(profiles[index], 'launch-status.json'),
        'utf8',
      ),
    );
    assert.equal(status.windowVisible, true);
  }
  console.log(
    'PASS: two packaged Game Jam! windows load the production canvas in separate visible Windows/taskbar windows and join an isolated fixture server',
  );
} finally {
  owner?.stop();
  // These are only the processes created above, never existing user apps.
  await Promise.all(
    children.map(async (child) => {
      if (child.exitCode !== null || child.killed) return;
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await exited;
    }),
  );
  await server?.close();
  for (const profile of profiles) {
    assert.equal(path.dirname(profile), path.join(base, 'test-users'));
    assert.equal(
      testProfilePath(base, [`${TEST_PROFILE_FLAG}${path.basename(profile)}`]),
      profile,
    );
    await fs.rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  }
  assert.ok(path.basename(root).startsWith('canvas-packaged-windows-'));
  await fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
