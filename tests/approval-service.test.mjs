import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApprovalService } from '../src/application/ai/approval-service.ts';

function fixture(queue = true) {
  const events = [];
  let valid = true,
    updating = false,
    busy = false;
  const ports = {
    assertAuthorized: () => {
      events.push('authorize');
      if (!valid) throw Error('authority revoked');
    },
    prepare: async () => {
      events.push('flush');
    },
    serial: async (fn) => {
      events.push('queue');
      return fn();
    },
    queueSupported: () => queue,
    updating: () => updating,
    busy: () => busy,
    reserve: async (input) => {
      events.push('reserve');
      return input;
    },
    execute: async (input) => {
      events.push('execute');
      return input;
    },
  };
  return {
    ports,
    events,
    service: new ApprovalService(ports),
    revoke: () => {
      valid = false;
    },
    update: () => {
      updating = true;
    },
    busy: () => {
      busy = true;
    },
  };
}
const input = {
  approval: {
    id: 'request',
    revision: 4,
    reviewToken: 'review',
    commandId: 'stable',
  },
  taskPath: '',
  providerId: 'codex-cli',
  modelId: null,
};

test('approval rechecks binding and human authorization after editor flush and queue entry', async () => {
  const f = fixture();
  const result = await f.service.start(input, () => f.events.push('human'));
  assert.deepEqual(f.events, [
    'authorize',
    'human',
    'flush',
    'queue',
    'authorize',
    'human',
    'reserve',
  ]);
  assert.equal(result.queueVersion, 1);
  assert.equal(result.approval.commandId, 'stable');
  assert.equal(input.queueVersion, undefined);
  for (const mode of ['revoked', 'updating']) {
    const g = fixture();
    g.ports.prepare = async () =>
      mode === 'revoked' ? g.revoke() : g.update();
    await assert.rejects(
      g.service.start(input),
      mode === 'revoked' ? /authority revoked/ : /업데이트/,
    );
    assert.equal(g.events.includes('reserve'), false);
    assert.equal(g.events.includes('execute'), false);
  }
});

test('approval queues while busy only with queue support; legacy execution remains immediate and exclusive', async () => {
  const queued = fixture();
  queued.busy();
  await queued.service.start(input);
  assert.ok(queued.events.includes('reserve'));
  const direct = fixture(false);
  await direct.service.start(input);
  assert.ok(direct.events.includes('execute'));
  const busy = fixture(false);
  busy.busy();
  await assert.rejects(busy.service.start(input), /다른 AI 작업/);
  assert.equal(busy.events.includes('flush'), false);
});
