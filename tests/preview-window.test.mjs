import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import {
  PREVIEW_PRESETS,
  PREVIEW_CHROME,
  normalizePreviewWindow,
  previewViewport,
  selectPreviewPreset,
  viewportRatio,
  fitPreviewViewport,
  withPreviewKeyboardBridge,
} from '../src/preview-window.ts';

const windowState = {
  x: 100,
  y: 200,
  width: 800,
  height: 600,
  collapsed: false,
};

test('old preview states stay freely resizable and do not lose geometry', () => {
  assert.deepEqual(normalizePreviewWindow(windowState), windowState);
  assert.equal(
    previewViewport(windowState).height,
    600 - PREVIEW_CHROME.height,
  );
});

test('all fixed presets expose exactly the advertised HTML viewport', () => {
  assert.ok(PREVIEW_PRESETS.length >= 30);
  assert.equal(
    new Set(PREVIEW_PRESETS.map((preset) => preset.id)).size,
    PREVIEW_PRESETS.length,
  );
  for (const preset of PREVIEW_PRESETS) {
    const state = selectPreviewPreset(windowState, preset.id);
    assert.deepEqual(previewViewport(state), {
      width: preset.width,
      height: preset.height,
      ratio: preset.ratio,
    });
    assert.equal(state.x, windowState.x);
    assert.equal(state.y, windowState.y);
    // Fixed sizes cannot be overridden by stale drag events or IPC values.
    assert.deepEqual(
      normalizePreviewWindow({ ...state, width: 100, height: 100 }),
      state,
    );
  }
});

test('switching fixed presets and minimizing preserves the last free size', () => {
  const mobile = selectPreviewPreset(windowState, 'mobile-320');
  const pc = selectPreviewPreset({ ...mobile, collapsed: true }, 'pc-1440');
  const free = selectPreviewPreset(pc, 'free');
  assert.equal(free.width, windowState.width);
  assert.equal(free.height, windowState.height);
  assert.equal(free.collapsed, true);
  const resized = { ...free, width: 900, height: 700 };
  const again = selectPreviewPreset(
    selectPreviewPreset(resized, 'pc-720'),
    'free',
  );
  assert.equal(again.width, 900);
  assert.equal(again.height, 700);
});

test('ratios are mathematically accurate, including nonstandard displays', () => {
  assert.equal(viewportRatio(1080, 720), '3:2');
  assert.equal(viewportRatio(1440, 1080), '4:3');
  assert.equal(viewportRatio(3440, 1440), '43:18');
  assert.equal(viewportRatio(5120, 1440), '32:9');
  assert.equal(viewportRatio(1440, 900), '16:10');
  assert.equal(viewportRatio(2520, 1080), '21:9');
});

test('fullscreen fits every fixed resolution without changing its aspect ratio or viewport', () => {
  for (const preset of PREVIEW_PRESETS) {
    const scale = fitPreviewViewport(preset.width, preset.height, 1440, 862);
    assert.ok(scale > 0);
    assert.ok(preset.width * scale <= 1440 + 0.001);
    assert.ok(preset.height * scale <= 862 + 0.001);
  }
  assert.equal(fitPreviewViewport(1280, 720, 1920, 1080), 1.5);
});

test('preview-only keyboard bridge forwards only Escape and escapes its identifier', () => {
  const original = '<!doctype html><html><body>game</body></html>';
  const id = 'preview</script>';
  const result = withPreviewKeyboardBridge(original, id);
  assert.ok(result.startsWith(original));
  const script = result.slice(
    result.indexOf('>window.') + 1,
    result.lastIndexOf('</script>'),
  );
  let listener;
  const messages = [];
  vm.runInNewContext(script, {
    window: {
      addEventListener: (name, callback) => {
        if (name === 'keydown') listener = callback;
      },
      parent: { postMessage: (message) => messages.push(message) },
    },
  });
  listener({ key: 'w' });
  assert.equal(messages.length, 0);
  listener({ key: 'Escape' });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, id);
  assert.equal(messages[0].type, 'game-canvas:preview-escape');
});
