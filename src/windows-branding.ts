import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** Repair the installed shell icons once per version, without touching user data. */
export async function repairWindowsBranding(
  executable: string,
  resources: string,
  version: string,
) {
  const installRoot = path.resolve(path.dirname(executable), '..');
  if (path.basename(installRoot) !== 'game_canvas') return;
  try {
    await fs.access(path.join(installRoot, 'Update.exe'));
  } catch {
    return;
  }
  const iconPath = path.join(resources, 'icon.ico');
  const iconHash = createHash('sha256')
    .update(await fs.readFile(iconPath))
    .digest('hex')
    .toUpperCase();
  try {
    const marker = JSON.parse(
      (
        await fs.readFile(
          path.join(installRoot, 'game-jam-branding.json'),
          'utf8',
        )
      ).replace(/^\uFEFF/, ''),
    );
    if (marker.version === version && marker.iconHash === iconHash) return;
  } catch {
    // First launch after installation or an upgrade needs shell icon repair.
  }
  await promisify(execFile)(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(resources, 'repair-windows-branding.ps1'),
      '-InstallDirectory',
      installRoot,
      '-IconPath',
      iconPath,
      '-Version',
      version,
    ],
    { windowsHide: true, timeout: 20_000 },
  );
}
