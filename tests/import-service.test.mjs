import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  FileImportService,
  assertImportAccess,
} from '../src/application/editing/import-service.ts';
import { filesystemProjectRepository } from '../src/adapters/filesystem/local-project-repository.ts';
const payload = {
  x: 20,
  y: 30,
  imagePurpose: 'asset',
  files: [{ name: 'note.md', content: '# 입력 문서\n\n내용' }],
};
test('import history failure rolls back a local clipboard publication and AI/cancellation guards write nothing', async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-import-service-'),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repository = filesystemProjectRepository(root);
  let locked = false;
  const service = new FileImportService({
    repository,
    assertCurrent: () => {},
    assertMutation: () => {
      if (locked) throw Error('AI locked');
    },
  });
  await assert.rejects(
    service.import(payload, {
      assertCurrent: () => {},
      cancelled: () => false,
      record: async () => {
        throw Error('history failure');
      },
    }),
    /history failure/,
  );
  assert.deepEqual(await repository.capture(), {});
  locked = true;
  await assert.rejects(service.import(payload), /AI locked/);
  assert.deepEqual(await repository.capture(), {});
  locked = false;
  await assert.rejects(
    service.import(payload, {
      assertCurrent: () => {},
      cancelled: () => true,
      record: async () => {},
    }),
  );
  assert.deepEqual(await repository.capture(), {});
  const result = await service.import(payload);
  assert.equal(result.length, 1);
  assert.match(result[0].body, /내용/);
});
test('shared import checks connection/role before publication and acknowledges only after success in the same session', async () => {
  let state = { connected: false, role: 'admin' },
    commands = 0,
    ack = 0,
    changed = 0,
    current = true,
    fail = false;
  const service = new FileImportService({
    assertCurrent: () => {
      if (!current) throw Error('stale session');
    },
    shared: {
      state: () => state,
      command: async () => {
        commands++;
        if (fail) throw Error('save failure');
        return [];
      },
      acknowledge: () => ack++,
      changed: () => changed++,
    },
  });
  await assert.rejects(service.import(payload), /연결/);
  state = { connected: true, role: 'viewer' };
  await assert.rejects(service.import(payload), /관리자/);
  assert.equal(commands, 0);
  state = { connected: true, role: 'editor' };
  fail = true;
  await assert.rejects(service.import(payload), /save failure/);
  assert.equal(ack, 0);
  assert.equal(changed, 0);
  fail = false;
  await service.import(payload);
  assert.equal(ack, 1);
  assert.equal(changed, 1);
  current = false;
  await assert.rejects(service.import(payload), /stale session/);
  assert.equal(commands, 2);
  assert.doesNotThrow(() => assertImportAccess());
});
