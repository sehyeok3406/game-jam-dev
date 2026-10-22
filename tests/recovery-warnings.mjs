import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CollaborationClient } from '../src/collaboration-client.ts';

/** Real filesystem failures at all three bootstrap recovery-warning call sites. */
export async function exerciseRecoveryWarnings({
  directory,
  url,
  key = '',
  onStep = () => {},
}) {
  const name = '오류 경고 검증';
  const created = await CollaborationClient.create(url, key, '관리자', name, {
    'project.md': '# 로그에 남기지 않는 본문',
  });
  const client = new CollaborationClient(created.credentials, () => {});
  client.accept(created.result);
  try {
    const runtime = path.join(
      directory,
      created.credentials.projectId,
      'runtime.json',
    );
    const saved = path.join(directory, 'warning-runtime-preserved');
    await fs.rename(runtime, saved);
    await fs.mkdir(runtime);
    try {
      // persist's recoveryError and history restore's explicit checkpoint warning.
      await client.command('documents:create-idea', { x: 10, y: 20 });
      onStep('runtime');
      assert.ok(client.lastCommandHistoryId);
      const restored = await client.request('restore', {
        id: client.lastCommandHistoryId,
        revision: client.state.revision,
        version: 'before',
      });
      client.accept(restored);
      onStep('restore');
    } finally {
      await fs.rmdir(runtime);
      await fs.rename(saved, runtime);
    }
    const markers = path.join(directory, '.project-lifecycle');
    const savedMarkers = path.join(directory, 'warning-markers-preserved');
    const existed = await fs.stat(markers).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (existed) await fs.rename(markers, savedMarkers);
    await fs.writeFile(markers, 'blocked marker directory');
    try {
      await client.request('trash', {
        typedName: name,
        confirmTeam: true,
        expectedVersion: 0,
      });
      onStep('trash');
      // The purge's final marker takes saveLifecycleMarker's separate catch path.
      await client.request('trash-purge', { typedName: name });
      onStep('purge');
      await assert.rejects(
        client.request('state'),
        (error) => error.code === 'PROJECT_PURGED',
      );
    } finally {
      await fs.unlink(markers);
      if (existed) await fs.rename(savedMarkers, markers);
    }
    return {
      projectId: created.credentials.projectId,
      token: created.credentials.token,
      body: '# 로그에 남기지 않는 본문',
    };
  } finally {
    client.stop();
  }
}

export function assertRecoveryWarnings(warnings, requestRecords, scenario) {
  assert.ok(warnings.length >= 3, 'all recovery warning paths must execute');
  assert.ok(warnings.some((entry) => entry.phase === 'checkpoint'));
  assert.ok(warnings.some((entry) => entry.phase === 'lifecycle'));
  for (const entry of warnings) {
    assert.equal(entry.event, 'recovery-pending');
    assert.match(entry.project, /^[a-f0-9]{16}$/);
  }
  const projectRefs = new Set(warnings.map((entry) => entry.project));
  assert.equal(projectRefs.size, 1);
  assert.ok(
    requestRecords.some((entry) => projectRefs.has(entry.project)),
    'warning and HTTP request must use the same process-scoped reference',
  );
  const serialized = JSON.stringify([...warnings, ...requestRecords]);
  for (const secret of [scenario.projectId, scenario.token, scenario.body])
    assert.ok(!serialized.includes(secret));
}
