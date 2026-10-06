import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { repairWindowsBranding } from '../src/windows-branding.ts';

test('a completed repair preserves deleted shortcuts and accepts the Windows UTF-8 marker', async () => {
  const fixture = await fs.mkdtemp(
    path.join(os.tmpdir(), 'game-jam-branding-'),
  );
  try {
    const installRoot = path.join(fixture, 'game_canvas');
    const resources = path.join(installRoot, 'app-0.10.3', 'resources');
    await fs.mkdir(resources, { recursive: true });
    const icon = await fs.readFile(
      new URL('../assets/icon.ico', import.meta.url),
    );
    await fs.writeFile(path.join(resources, 'icon.ico'), icon);
    await fs.writeFile(
      path.join(installRoot, 'Update.exe'),
      'must not execute',
    );
    const marker =
      '\uFEFF' +
      JSON.stringify({
        version: '0.10.3',
        iconHash: createHash('sha256').update(icon).digest('hex').toUpperCase(),
      });
    await fs.writeFile(
      path.join(installRoot, 'game-jam-branding.json'),
      marker,
    );
    // No repair script or launcher exists: a repeated repair would fail.
    await repairWindowsBranding(
      path.join(installRoot, 'app-0.10.3', 'Game Canvas.exe'),
      resources,
      '0.10.3',
    );
    assert.equal(
      await fs.readFile(
        path.join(installRoot, 'game-jam-branding.json'),
        'utf8',
      ),
      marker,
    );
  } finally {
    assert.equal(path.dirname(fixture), os.tmpdir());
    assert.ok(path.basename(fixture).startsWith('game-jam-branding-'));
    await fs.rm(fixture, { recursive: true, force: true });
  }
});

test('portable packages skip installed shortcut repair', async () => {
  await repairWindowsBranding(
    path.join(os.tmpdir(), 'Game Jam!-win32-x64', 'Game Canvas.exe'),
    path.join(os.tmpdir(), 'missing-branding-resources'),
    '0.10.3',
  );
});
