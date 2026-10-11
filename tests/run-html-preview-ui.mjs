import { build } from 'vite';
import { spawn } from 'node:child_process';
import path from 'node:path';
import electron from 'electron';

const archive = process.argv[2];
if (!archive)
  await build({
    configFile: 'vite.renderer.config.mts',
    base: './',
    build: { outDir: 'out/html-preview-ui/renderer' },
  });
await new Promise((resolve, reject) => {
  const child = spawn(electron, ['tests/html-preview-ui.electron.mjs'], {
    windowsHide: true,
    stdio: 'inherit',
    env: {
      ...process.env,
      QA_RENDERER: path.resolve(
        archive
          ? path.join(archive, '.vite/renderer/main_window/index.html')
          : 'out/html-preview-ui/renderer/index.html',
      ),
    },
  });
  child.once('error', reject);
  child.once('exit', (code) =>
    code === 0 ? resolve() : reject(Error('HTML preview QA failed: ' + code)),
  );
});
