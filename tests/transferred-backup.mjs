import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from '../src/markdown.ts';
import { inspectDatabase } from '../src/server/operations/backup-database.ts';
import { statDirectory } from '../src/trash-files.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';

export function assertWindowsFixture(expected) {
  assert.equal(
    expected.schema,
    2,
    'Regenerate the Windows archive with extended recovery cases',
  );
  assert.equal(expected.sourcePlatform, 'win32');
  for (const created of [
    expected.owner,
    expected.viewer,
    expected.trash,
    expected.purged,
  ]) {
    assert.match(created.credentials.projectId, /^[a-f0-9-]{36}$/);
    assert.ok(created.credentials.token);
  }
  assert.equal(expected.trash.lifecycle.status, 'trashed');
  assert.ok(expected.trash.lifecycle.identity);
  assert.ok(expected.purged.version >= 1);
  assert.ok(['starting', 'running'].includes(expected.ai.running.status));
  assert.equal(expected.ai.queued.status, 'queued');
  assert.equal(expected.ai.job.queueTaskId, expected.ai.running.taskId);
  assert.ok(expected.replay.historyId);
}
export async function assertTransferredSnapshot(
  directory,
  expected,
  report,
  fixtureDirectory,
) {
  assertWindowsFixture(expected);
  const stored = inspectDatabase(path.join(directory, 'sync.sqlite'));
  const main = stored.projects.find(
    (project) => project.id === expected.owner.credentials.projectId,
  );
  assert.deepEqual(main.files, expected.files);
  assert.deepEqual(main.history, expected.history);
  assert.equal(main.revision, expected.revision);
  assert.deepEqual(
    main.aiQueue.find((task) => task.taskId === expected.ai.running.taskId),
    expected.ai.running,
  );
  assert.deepEqual(
    main.aiQueue.find((task) => task.taskId === expected.ai.queued.taskId),
    expected.ai.queued,
  );
  assert.deepEqual(main.job, expected.ai.job);
  assert.equal(
    main.applied.filter((entry) => entry.id === expected.replay.command.id)
      .length,
    1,
  );
  assert.equal(
    new Map(stored.tombstones).get(expected.purged.credentials.projectId),
    expected.purged.version,
  );
  assert.ok(
    !stored.projects.some(
      (project) => project.id === expected.purged.credentials.projectId,
    ),
  );
  const trash = stored.projects.find(
    (project) => project.id === expected.trash.credentials.projectId,
  );
  assert.deepEqual(trash.files, expected.trash.files);
  const retained = path.join(
    directory,
    '.project-trash',
    trash.lifecycle.trashId,
    'project',
  );
  const identity = await statDirectory(retained);
  assert.equal(trash.lifecycle.identity, identity);
  assert.notEqual(identity, expected.trash.lifecycle.identity);
  assert.ok(
    report.transformations.some(
      (item) =>
        item.projectId === trash.id &&
        item.before === expected.trash.lifecycle.identity &&
        item.after === identity,
    ),
  );
  await assert.rejects(
    fs.stat(path.join(directory, expected.purged.credentials.projectId)),
    { code: 'ENOENT' },
  );
  // Challenge startup with an actual old Windows checkpoint, after the verified restore.
  const stale = path.join(fixtureDirectory, 'stale-checkpoint');
  const head = JSON.parse(
    await fs.readFile(path.join(stale, 'head.json'), 'utf8'),
  );
  assert.match(head.checkpoint, /^[a-f0-9-]{36}$/);
  const state = JSON.parse(
    await fs.readFile(
      path.join(stale, 'checkpoints', head.checkpoint, 'state.json'),
      'utf8',
    ),
  );
  assert.equal(state.id, expected.purged.credentials.projectId);
  await fs.cp(
    stale,
    path.join(directory, expected.purged.credentials.projectId),
    { recursive: true },
  );
}

/** Same checks before and after an additional process restart; no real AI executor. */
export async function verifyTransferredRuntime({
  url,
  directory,
  expected,
  restarted = false,
}) {
  const clients = [];
  const request = (credentials, action, input = {}) =>
    CollaborationClient.fetch(
      url,
      `/projects/${credentials.projectId}/${action}`,
      input,
      credentials.token,
    );
  const open = (credentials) => {
    const client = new CollaborationClient(
      { ...credentials, serverUrl: url },
      () => {},
    );
    clients.push(client);
    return client;
  };
  try {
    const owner = open(expected.owner.credentials);
    await owner.refresh();
    assert.equal(owner.state.aiRun.status, 'failed');
    assert.equal(owner.state.aiRun.runId, expected.ai.running.runId);
    const running = owner.state.aiQueue.find(
      (task) => task.taskId === expected.ai.running.taskId,
    );
    assert.equal(running.status, 'failed');
    assert.equal(running.runId, expected.ai.running.runId);
    const { baseline: _baseline, ...queued } = expected.ai.queued;
    assert.deepEqual(
      owner.state.aiQueue.find((task) => task.taskId === queued.taskId),
      queued,
    );
    const originalTask = matter(expected.files[expected.ai.running.taskPath]);
    const failedTask = matter(owner.files[expected.ai.running.taskPath]);
    assert.equal(failedTask.data.status, 'failed');
    assert.ok(Number.isFinite(Date.parse(failedTask.data.ai_updated_at)));
    const stableMetadata = ({
      status: _status,
      ai_updated_at: _updated,
      ...rest
    }) => rest;
    assert.deepEqual(
      stableMetadata(failedTask.data),
      stableMetadata(originalTask.data),
    );
    assert.equal(failedTask.content, originalTask.content);
    const stableFiles = (files) =>
      Object.fromEntries(
        Object.entries(files).filter(
          ([relative]) => relative !== expected.ai.running.taskPath,
        ),
      );
    assert.deepEqual(stableFiles(owner.files), stableFiles(expected.files));
    assert.equal(owner.state.revision, expected.revision + 1);
    const historyBefore = await owner.history();
    assert.equal(historyBefore.length, expected.history.length + 1);
    for (let replay = 0; replay < 2; replay++) {
      const result = await owner.request('command', expected.replay.command);
      assert.equal(result.historyId, expected.replay.historyId);
      assert.deepEqual(result.result, expected.replay.result);
    }
    await owner.refresh();
    assert.equal(owner.state.revision, expected.revision + 1);
    assert.equal((await owner.history()).length, historyBefore.length);
    const persisted = inspectDatabase(path.join(directory, 'sync.sqlite'));
    const main = persisted.projects.find(
      (project) => project.id === expected.owner.credentials.projectId,
    );
    assert.equal(main.job, null);
    assert.deepEqual(
      main.history.slice(0, expected.history.length),
      expected.history,
    );
    const failure = main.history.at(-1).entry;
    assert.equal(failure.kind, 'ai');
    assert.equal(failure.status, 'failed');
    assert.equal(failure.taskPath, expected.ai.running.taskPath);
    assert.equal(
      main.applied.filter((entry) => entry.id === expected.replay.command.id)
        .length,
      1,
    );
    const viewer = open(expected.viewer.credentials);
    await viewer.refresh();
    assert.equal(viewer.state.role, 'viewer');
    await assert.rejects(
      viewer.command('documents:create-idea', { x: 1, y: 2 }),
      /뷰어/,
    );
    const trash = expected.trash.credentials;
    if (!restarted) {
      await assert.rejects(
        request(trash, 'state'),
        (error) => error.code === 'PROJECT_TRASHED',
      );
      const lifecycle = await request(trash, 'lifecycle');
      assert.equal(lifecycle.status, 'trashed');
      assert.equal(lifecycle.version, expected.trash.lifecycle.version);
      const restored = await request(trash, 'trash-restore');
      assert.equal(restored.status, 'active');
      assert.equal(restored.version, lifecycle.version + 1);
    }
    const state = await request(trash, 'state');
    assert.deepEqual(state.files, expected.trash.files);
    assert.equal(
      state.state.lifecycleVersion,
      expected.trash.lifecycle.version + 1,
    );
    await assert.rejects(
      request(expected.purged.credentials, 'state'),
      (error) => error.code === 'PROJECT_PURGED',
    );
    const after = inspectDatabase(path.join(directory, 'sync.sqlite'));
    assert.equal(
      new Map(after.tombstones).get(expected.purged.credentials.projectId),
      expected.purged.version,
    );
    assert.ok(
      !after.projects.some(
        (project) => project.id === expected.purged.credentials.projectId,
      ),
    );
    return {
      decodedSnapshot: true,
      trashIdentityRebound: true,
      trashRestored: true,
      tombstoneWithStaleCheckpoint: true,
      activeAiFailedOnce: true,
      queuedReservationPreserved: true,
      receiptReplayOnce: true,
      roles: true,
      restart: restarted,
    };
  } finally {
    clients.forEach((client) => client.stop());
  }
}
