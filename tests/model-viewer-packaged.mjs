import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  boot,
  stop,
  wait,
  js,
  send,
  mouse,
  root,
  profile,
} from './helpers/packaged-canvas.mjs';

function movingTriangle() {
  const positions = [-0.45, -0.32, 0, 0.45, -0.32, 0, 0, 0.46, 0];
  const times = [0, 1];
  const translations = [0, 0, 0, 0.65, 0, 0];
  const binary = Buffer.from(
    new Float32Array([...positions, ...times, ...translations]).buffer,
  );
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'AnimatedTriangle' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    extensionsUsed: ['KHR_materials_unlit'],
    materials: [
      {
        doubleSided: true,
        pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] },
        extensions: { KHR_materials_unlit: {} },
      },
    ],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 8 },
      { buffer: 0, byteOffset: 44, byteLength: 24 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        type: 'VEC3',
        count: 3,
        min: [-0.45, -0.32, 0],
        max: [0.45, 0.46, 0],
      },
      {
        bufferView: 1,
        componentType: 5126,
        type: 'SCALAR',
        count: 2,
        min: [0],
        max: [1],
      },
      { bufferView: 2, componentType: 5126, type: 'VEC3', count: 2 },
    ],
    animations: [
      {
        name: 'Translation',
        samplers: [{ input: 1, output: 2, interpolation: 'LINEAR' }],
        channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
      },
    ],
  };
  const raw = JSON.stringify(gltf);
  const json = Buffer.from(raw.padEnd(Math.ceil(raw.length / 4) * 4));
  const header = Buffer.alloc(12);
  header.write('glTF');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + json.length + binary.length, 8);
  const chunk = (kind, payload) => {
    const prefix = Buffer.alloc(8);
    prefix.writeUInt32LE(payload.length);
    prefix.write(kind, 4, 'ascii');
    return [prefix, payload];
  };
  return Buffer.concat([
    header,
    ...chunk('JSON', json),
    ...chunk('BIN\0', binary),
  ]);
}

const tool = (label) =>
  `[...document.querySelectorAll('.model-viewer__tools button')].find(button => button.textContent.trim() === ${JSON.stringify(label)})`;
const follow = tool('Follow Camera');
const fit = tool('시점 초기화');
const slider = `document.querySelector('.model-viewer__transport input')`;
const seek = (value) =>
  js(`(() => {
  const input = ${slider};
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${value});
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);

async function triangle() {
  const clip = await js(`(() => {
    const r = document.querySelector('.model-viewer__viewport').getBoundingClientRect();
    return { x: r.x, y: r.y + 55, width: r.width, height: r.height - 95, scale: 1 };
  })()`);
  const shot = await send('Page.captureScreenshot', { clip });
  const bounds = await js(`(async () => {
    const image = new Image();
    image.src = 'data:image/png;base64,${shot.data}';
    await image.decode();
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, image.width, image.height).data;
    let minX = image.width, minY = image.height, maxX = -1, maxY = -1;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 160 || data[i + 1] > 80 || data[i + 2] > 80) continue;
      const x = i / 4 % image.width, y = Math.floor(i / 4 / image.width);
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    return [minX, minY, maxX, maxY];
  })()`);
  assert.ok(bounds[2] - bounds[0] > 25, `Visible triangle: ${bounds}`);
  return bounds;
}

function sameFraming(before, after) {
  assert.ok(
    before.every((edge, index) => Math.abs(edge - after[index]) <= 2),
    `${before} vs ${after}`,
  );
}

try {
  const fixture = path.join(root, 'moving-triangle.glb');
  await fs.writeFile(fixture, movingTriangle());
  await boot();
  const input = await send('Runtime.evaluate', {
    expression: `(() => {
    const input = document.createElement('input');
    input.type = 'file'; document.body.append(input); window.modelFixture = input;
    return input;
  })()`,
  });
  await send('DOM.setFileInputFiles', {
    files: [fixture],
    objectId: input.result.objectId,
  });
  await js(`(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(window.modelFixture.files[0]);
    document.querySelector('.react-flow').dispatchEvent(new DragEvent('drop', { bubbles: true, clientX: 460, clientY: 380, dataTransfer }));
    window.modelFixture.remove();
  })()`);
  const open = `document.querySelector('[aria-label="3D 미리보기 열기"]')`;
  await wait(`!!${open}`);
  await js(`${open}.click()`);
  await wait(`!!${follow} && !${follow}.disabled`);
  assert.equal(await js(`${follow}.getAttribute('aria-pressed')`), 'false');
  await js(`${tool('격자')}.click()`);
  const start = await triangle();
  await seek(0.85);
  await wait(`Number(${slider}.value) > 0.8`);
  assert.ok(Math.abs((await triangle())[0] - start[0]) > 30);
  await seek(0);

  await js(`${tool('Pan')}.click()`);
  await mouse('mousePressed', 720, 450);
  await mouse('mouseMoved', 760, 470);
  await mouse('mouseReleased', 760, 470);
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: 720,
    y: 450,
    deltaX: 0,
    deltaY: -80,
  });
  await js(`${follow}.click()`);
  const adjusted = await triangle();
  assert.notDeepEqual(adjusted, start);
  await seek(0.85);
  sameFraming(adjusted, await triangle());
  await js(`document.querySelector('.model-viewer__play').click()`);
  await wait(`Number(${slider}.value) < 0.6`); // The loop wrapped.
  await js(`document.querySelector('.model-viewer__play').click()`);
  sameFraming(adjusted, await triangle());
  await seek(0.85);
  await js(`${fit}.click()`);
  sameFraming(start, await triangle());
  await js(`${follow}.click()`);
  await seek(0.1);
  assert.ok(Math.abs((await triangle())[0] - start[0]) > 30);
  console.log(
    'PASS: Windows GLB follows translation during seek and loop, preserving Pan and zoom and resetting around the current pose.',
  );
} finally {
  await stop();
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.equal(
    path.dirname(profile),
    path.resolve(process.env.APPDATA, 'Game Canvas', 'test-users'),
  );
  for (const directory of [root, profile])
    await fs.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
}
