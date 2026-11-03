// Actual Windows file dialog, isolated application profile, real saved bytes. No AI.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import {
  root,
  profile,
  game,
  boot,
  stop,
  js,
  appProcessId,
} from './helpers/packaged-canvas.mjs';
const html =
  '<!doctype html><html><head><title>HTML export</title></head><body>내보내기 검사<script>document.body.dataset.ready="yes";</script></body></html>';
await fs.mkdir(path.join(game, 'output'), { recursive: true });
await fs.writeFile(path.join(game, 'output/index.html'), html);
async function exportWithDialog(destination, cancel = false) {
  const pending = js(
    "window.gameCanvas.exportPreviewHtml('output/index.html')",
  );
  const helper = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.resolve('tests/helpers/save-html-dialog.ps1'),
      '-TargetProcessId',
      String(appProcessId()),
      ...(cancel ? ['-Cancel'] : ['-Destination', destination]),
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  for (const stream of [helper.stdout, helper.stderr])
    stream.on('data', (d) => (output += d));
  const closed = new Promise((resolve, reject) => {
    helper.once('error', reject);
    helper.once('exit', (code) =>
      code === 0 ? resolve() : reject(Error(output)),
    );
  });
  const [result] = await Promise.all([pending, closed]);
  return result;
}
try {
  await boot();
  const target = path.join(root, 'export.html');
  assert.equal(await exportWithDialog(target, true), false);
  await assert.rejects(fs.access(target));
  assert.equal(await exportWithDialog(target), true);
  assert.deepEqual(await fs.readFile(target), Buffer.from(html));
  await assert.rejects(
    exportWithDialog(path.join(game, 'blocked.html')),
    /프로젝트 밖/,
  );
  await assert.rejects(fs.access(path.join(game, 'blocked.html')));
  console.log(
    'PASS: actual owned Windows save/cancel dialogs, exact saved HTML and protected project path',
  );
} finally {
  await stop(true);
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.equal(
    path.dirname(profile),
    path.resolve(process.env.APPDATA, 'Game Canvas', 'test-users'),
  );
  await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
