// Local test-only clipboard service. No clipboard payload is returned or persisted.
import {
  app,
  clipboard,
  ClipboardItem,
  nativeImage,
  BrowserWindow,
} from 'electron';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
app.setPath('userData', path.resolve('out/qa/clipboard-helper-profile'));
app.on('window-all-closed', () => {});
async function run() {
  await app.whenReady();
  const backup = [];
  for (const item of await clipboard.read()) {
    const data = {};
    for (const type of item.types) data[type] = await item.getType(type);
    backup.push(new ClipboardItem(data));
  }
  const png = nativeImage
    .createFromBuffer(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGL538AAAAAA///5tjreAAAABklEQVQDAAQRAYTXKkMGAAAAAElFTkSuQmCC',
        'base64',
      ),
    )
    .toPNG();
  const restore = async () => {
    if (backup.length) await clipboard.write(backup);
    else clipboard.clear();
  };
  const server = createServer(async (req, res) => {
    if (req.headers['x-test-token'] !== process.env.QA_CLIPBOARD_TOKEN) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      if (req.url === '/ready') {
        res.end('ok');
        return;
      }
      if (req.url === '/close') {
        await restore();
        res.end('ok');
        server.close(() => app.exit());
        return;
      }
      if (req.url === '/match-text' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) {
          body += chunk.toString();
          if (body.length > 100_000) throw Error('Test input too large');
        }
        const { expected } = JSON.parse(body);
        if (typeof expected !== 'string') throw Error('Expected test text');
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            matches: (await clipboard.readText()) === expected,
          }),
        );
        return;
      }
      if (req.url === '/image')
        await clipboard.write([
          new ClipboardItem({
            'image/png': new Blob([png]),
            'text/html': new Blob(['<img src="ignored">']),
          }),
        ]);
      else if (req.url === '/text')
        await clipboard.writeText('test external text');
      else if (req.url === '/bitmap')
        await new Promise((resolve, reject) => {
          const child = spawn(
            'powershell.exe',
            [
              '-NoProfile',
              '-STA',
              '-Command',
              'Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $bitmap = [System.Drawing.Bitmap]::new(8, 8); try { [System.Windows.Forms.Clipboard]::SetImage($bitmap) } finally { $bitmap.Dispose() }',
            ],
            { windowsHide: true, stdio: 'ignore' },
          );
          child.on('error', reject);
          child.on('exit', (code) =>
            code === 0
              ? resolve()
              : reject(Error('Windows bitmap copy failed')),
          );
        });
      else if (req.url === '/browser-image') {
        const win = new BrowserWindow({
          show: false,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            offscreen: true,
          },
        });
        try {
          await win.loadURL(
            'data:text/html,' +
              encodeURIComponent(
                `<img width="64" height="64" src="data:image/png;base64,${png.toString('base64')}">`,
              ),
          );
          await win.webContents.executeJavaScript(
            'document.querySelector("img").decode()',
          );
          win.webContents.copyImageAt(16, 16);
          await new Promise((r) => setTimeout(r, 150));
        } finally {
          win.destroy();
        }
      } else throw Error('Unknown test operation');
      res.end('ok');
    } catch (error) {
      res.writeHead(500);
      res.end(error.message);
    }
  });
  server.listen(Number(process.env.QA_CLIPBOARD_PORT), '127.0.0.1');
}
void run().catch((error) => {
  console.error(error);
  app.exit(1);
});
