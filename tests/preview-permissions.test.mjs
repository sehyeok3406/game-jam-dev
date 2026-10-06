import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import {
  PREVIEW_SANDBOX,
  previewPermissionAllowed,
  installPreviewPermissions,
} from '../src/preview-permissions.ts';
import { withPreviewKeyboardBridge } from '../src/preview-window.ts';

test('pointer lock is allowed only for fullscreen opaque preview subframes', () => {
  assert.equal(PREVIEW_SANDBOX, 'allow-scripts allow-pointer-lock');
  assert.equal(
    previewPermissionAllowed('pointerLock', true, true, false, 'about:srcdoc'),
    true,
  );
  for (const args of [
    ['pointerLock', true, false, false, 'about:srcdoc'],
    ['pointerLock', false, true, false, 'about:srcdoc'],
    ['pointerLock', true, true, true, 'about:srcdoc'],
    ['pointerLock', true, true, false, 'https://other.invalid'],
    ['media', true, true, false, 'about:srcdoc'],
    ['keyboardLock', true, true, false, 'about:srcdoc'],
  ])
    assert.equal(previewPermissionAllowed(...args), false);
  assert.equal(previewPermissionAllowed('fullscreen', true, false, true), true);
  assert.equal(
    previewPermissionAllowed('automatic-fullscreen', true, false, true),
    true,
  );
  assert.equal(
    previewPermissionAllowed('automatic-fullscreen', true, true, false),
    false,
  );
  assert.equal(
    previewPermissionAllowed('fullscreen', true, false, false),
    false,
  );
});

test('native checks enforce fullscreen state and release on exit', async () => {
  let check,
    request,
    destroyed = false;
  const scripts = [];
  const contents = {
    isDestroyed: () => destroyed,
    executeJavaScript: (script) => {
      scripts.push(script);
      return Promise.resolve();
    },
    session: {
      setPermissionCheckHandler: (callback) => {
        check = callback;
      },
      setPermissionRequestHandler: (callback) => {
        request = callback;
      },
    },
  };
  const window = Object.assign(new EventEmitter(), {
    webContents: contents,
    isDestroyed: () => destroyed,
  });
  installPreviewPermissions(window);
  const details = { isMainFrame: false, requestingUrl: 'about:srcdoc' };
  const ask = () =>
    new Promise((resolve) =>
      request(contents, 'pointerLock', resolve, details),
    );
  assert.equal(await ask(), false);
  window.emit('enter-html-full-screen');
  assert.equal(check(contents, 'pointerLock', '', details), true);
  assert.equal(await ask(), true);
  window.emit('leave-html-full-screen');
  assert.equal(await ask(), false);
  assert.ok(
    scripts.some((script) => script.includes('document.exitPointerLock')),
  );
  assert.equal(check({}, 'pointerLock', '', details), false);
  window.emit('enter-html-full-screen');
  destroyed = true;
  assert.equal(await ask(), false);
});

test('preview exit messages unlock only when sent by its own parent for its own card', () => {
  const html = withPreviewKeyboardBridge('<body>game</body>', 'card-1');
  const script = html.slice(
    html.indexOf('>window.') + 1,
    html.lastIndexOf('</script>'),
  );
  let listener,
    unlocked = 0;
  const parent = { postMessage: () => {} };
  vm.runInNewContext(script, {
    window: {
      parent,
      addEventListener: (name, callback) => {
        if (name === 'message') listener = callback;
      },
    },
    document: {
      pointerLockElement: {},
      exitPointerLock: () => {
        unlocked++;
      },
    },
  });
  const data = {
    type: 'game-canvas:preview-fullscreen',
    id: 'card-1',
    active: false,
  };
  listener({ source: {}, data });
  listener({ source: parent, data: { ...data, id: 'other-card' } });
  listener({ source: parent, data: { ...data, active: true } });
  assert.equal(unlocked, 0);
  listener({ source: parent, data });
  assert.equal(unlocked, 1);
});
