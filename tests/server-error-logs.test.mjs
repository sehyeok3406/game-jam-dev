import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTelemetry } from '../src/server/operations/telemetry.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import {
  exerciseRecoveryWarnings,
  assertRecoveryWarnings,
} from './recovery-warnings.mjs';

test('recovery warnings share request pseudonyms and rotate references across server instances', (t) => {
  const warnings = [],
    requests = [],
    id = randomUUID();
  t.mock.method(console, 'warn', (line) => warnings.push(JSON.parse(line)));
  const first = createTelemetry((entry) => requests.push(entry)),
    second = createTelemetry();
  try {
    const response = new EventEmitter();
    response.setHeader = () => {};
    response.statusCode = 200;
    first.observe({ url: `/projects/${id}/state?token=secret` }, response);
    response.emit('finish');
    first.recoveryError(id, 'checkpoint');
    first.recoveryError(id, 'lifecycle');
    second.recoveryError(id, 'checkpoint');
    assert.equal(warnings[0].project, requests[0].project);
    assert.equal(warnings[1].project, warnings[0].project);
    assert.notEqual(warnings[2].project, warnings[0].project);
    first.recoveryError(id, 'private path and token=secret');
    assert.equal(warnings[3].phase, 'unknown');
    const raw = JSON.stringify(warnings);
    assert.ok(!raw.includes(id));
    assert.ok(!raw.includes('secret'));
    assert.ok(!raw.includes('private path'));
  } finally {
    first.close();
    second.close();
  }
});

test('post-commit runtime, explicit checkpoint and lifecycle marker errors log only anonymized project references', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-recovery-warnings-'),
  );
  let server;
  t.after(async () => {
    await server?.close();
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(
      path.basename(directory).startsWith('gamejam-recovery-warnings-'),
    );
    await fs.rm(directory, { recursive: true, force: true });
  });
  const warnings = [],
    requests = [],
    steps = {};
  t.mock.method(console, 'warn', (line) => warnings.push(JSON.parse(line)));
  server = await createCollaborationServer({
    dataDirectory: directory,
    port: 0,
    requestLog: (entry) => requests.push(entry),
  });
  const scenario = await exerciseRecoveryWarnings({
    directory,
    url: `http://127.0.0.1:${server.port}`,
    onStep: (step) => {
      steps[step] = {
        checkpoint: warnings.filter((entry) => entry.phase === 'checkpoint')
          .length,
        lifecycle: warnings.filter((entry) => entry.phase === 'lifecycle')
          .length,
      };
    },
  });
  assertRecoveryWarnings(warnings, requests, scenario);
  assert.ok(steps.runtime.checkpoint >= 1);
  assert.ok(
    steps.restore.checkpoint - steps.runtime.checkpoint >= 2,
    'persist and explicit checkpoint catches must both log',
  );
  assert.ok(steps.trash.lifecycle >= 2);
  assert.ok(
    steps.purge.lifecycle - steps.trash.lifecycle >= 2,
    'persist and final lifecycle marker catches must both log',
  );
});
