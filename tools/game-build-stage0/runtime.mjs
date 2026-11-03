import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { rolldown } from 'rolldown';

const directory = process.argv[2];
const result = {
  runtime: process.versions,
  platform: process.platform,
  arch: process.arch,
  builds: [],
  payloads: [],
};
for (const id of ['pixi-image', 'three-image']) {
  const before = performance.now();
  const build = await rolldown({
    input: path.join(directory, 'workspace', id, 'main.js'),
    platform: 'browser',
  });
  try {
    const output = await build.generate({
      format: 'iife',
      codeSplitting: false,
      minify: true,
      comments: { legal: true },
      sourcemap: false,
    });
    const code = output.output[0].code;
    result.builds.push({
      id,
      jsBytes: Buffer.byteLength(code),
      sha256: createHash('sha256').update(code).digest('hex'),
      buildMs: Math.round(performance.now() - before),
    });
  } finally {
    await build.close();
  }
}
for (const bytes of [16_000_000, 32_000_000, 64_000_000]) {
  const start = performance.now();
  const text = JSON.stringify({
    files: { 'output/index.html': 'x'.repeat(bytes) },
  });
  const parsed = JSON.parse(text);
  result.payloads.push({
    bytes,
    jsonBytes: Buffer.byteLength(text),
    roundTrip: parsed.files['output/index.html'].length === bytes,
    elapsedMs: Math.round(performance.now() - start),
    memory: process.memoryUsage(),
    maxRssKb: process.resourceUsage().maxRSS,
  });
}
await fs.writeFile(
  path.join(directory, 'packaged-runtime-result.json'),
  JSON.stringify(result, null, 2),
);
