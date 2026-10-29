import assert from 'node:assert/strict';
import { app, clipboard, ClipboardItem, nativeImage } from 'electron';
import { spawn } from 'node:child_process';

async function run() {
  await app.whenReady();
  const previous = await clipboard.read();
  const backup = [];
  for (const item of previous) {
    const data = {};
    for (const type of item.types) data[type] = await item.getType(type);
    backup.push(new ClipboardItem(data));
  }
  let exit = 0;
  try {
    const png = nativeImage
      .createFromBuffer(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGL538AAAAAA///5tjreAAAABklEQVQDAAQRAYTXKkMGAAAAAElFTkSuQmCC',
          'base64',
        ),
      )
      .toPNG();
    await clipboard.write([
      new ClipboardItem({
        'image/png': new Blob([png]),
        'text/html': new Blob(['<img src="ignored">']),
      }),
    ]);
    let items = await clipboard.read();
    const image = items.find((i) => i.types.includes('image/png'));
    assert.ok(image, 'Electron PNG roundtrip must expose image/png');
    const received = nativeImage.createFromBuffer(
      Buffer.from(await (await image.getType('image/png')).arrayBuffer()),
    );
    assert.deepEqual(received.getSize(), { width: 1, height: 1 });
    assert.deepEqual(
      received.toBitmap(),
      nativeImage.createFromBuffer(png).toBitmap(),
    );
    const transparent = nativeImage
      .createFromBitmap(
        Buffer.from([
          0, 0, 255, 128, 0, 255, 0, 255, 255, 0, 0, 64, 0, 0, 0, 0,
        ]),
        { width: 2, height: 2 },
      )
      .toPNG();
    await clipboard.write([
      new ClipboardItem({ 'image/png': new Blob([transparent]) }),
    ]);
    const alphaItem = (await clipboard.read()).find((i) =>
      i.types.includes('image/png'),
    );
    const alphaImage = nativeImage.createFromBuffer(
      Buffer.from(await (await alphaItem.getType('image/png')).arrayBuffer()),
    );
    assert.deepEqual(
      alphaImage.toBitmap(),
      nativeImage.createFromBuffer(transparent).toBitmap(),
      'PNG transparency must survive the actual OS clipboard',
    );
    const mime = 'web application/x.gamejam.canvas-selection';
    await clipboard.write([
      new ClipboardItem({
        [mime]: new Blob(['{"version":1,"copyId":"test"}']),
      }),
    ]);
    items = await clipboard.read();
    const token = items.find((i) => i.types.includes(mime));
    assert.ok(token, 'Native custom token must roundtrip');
    assert.equal(
      await (await token.getType(mime)).text(),
      '{"version":1,"copyId":"test"}',
    );
    // Windows bitmap clipboard, as used by capture/paint applications; no user input is simulated.
    if (process.platform === 'win32') {
      await new Promise((resolve, reject) => {
        const child = spawn(
          'powershell.exe',
          [
            '-NoProfile',
            '-STA',
            '-Command',
            'Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $bitmap = [System.Drawing.Bitmap]::new(8, 8); try { [System.Windows.Forms.Clipboard]::SetImage($bitmap) } finally { $bitmap.Dispose() }',
          ],
          { windowsHide: true, stdio: 'pipe' },
        );
        child.on('error', reject);
        child.on('exit', (code) =>
          code === 0
            ? resolve()
            : reject(Error('Windows bitmap clipboard failed')),
        );
      });
      items = await clipboard.read();
      assert.ok(
        items.some((i) => i.types.includes('image/png')),
        'Windows bitmap clipboard must map to PNG',
      );
      await new Promise((resolve, reject) => {
        const child = spawn(
          'powershell.exe',
          [
            '-NoProfile',
            '-STA',
            '-Command',
            'Add-Type -AssemblyName System.Windows.Forms; $files = [System.Collections.Specialized.StringCollection]::new(); $null = $files.Add("C:\\clipboard-test.md"); [System.Windows.Forms.Clipboard]::SetFileDropList($files)',
          ],
          { windowsHide: true, stdio: 'pipe' },
        );
        child.on('error', reject);
        child.on('exit', (code) =>
          code === 0
            ? resolve()
            : reject(Error('Windows file clipboard failed')),
        );
      });
      items = await clipboard.read();
      const files = items.find((i) => i.types.includes('text/uri-list'));
      assert.ok(files, 'Windows copied files must expose a URI list');
      assert.match(
        await (await files.getType('text/uri-list')).text(),
        /file:\/\/\/C:\/clipboard-test.md/i,
      );
    }
    console.log(
      'PASS: actual Electron PNG/HTML, PNG transparency, app token and Windows bitmap clipboard formats',
    );
  } catch (error) {
    console.error(error);
    exit = 1;
  } finally {
    try {
      if (backup.length) await clipboard.write(backup);
      else clipboard.clear();
    } catch (error) {
      console.error(
        'Could not fully restore the previous OS clipboard:',
        error.message,
      );
      exit = 1;
    }
    app.exit(exit);
  }
}
void run().catch((error) => {
  console.error(error);
  app.exit(1);
});
