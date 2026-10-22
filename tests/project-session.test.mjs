import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProjectSession } from '../src/application/projects/project-session.ts';
import { DesktopProjectSessions } from '../src/desktop/project-session.ts';
import { DesktopLifecycle } from '../src/desktop/lifecycle.ts';

test('reopening the same root invalidates old work while preserving durable save scope', async () => {
  const sessions = new DesktopProjectSessions();
  await sessions.activate('C:/isolated/game');
  const first = sessions.ref,
    signal = sessions.signal,
    scope = sessions.saveScope;
  const released = [];
  sessions.own('stream', () => released.push('stream'));
  sessions.setWatcher({ close: async () => released.push('watcher') });
  await sessions.activate('C:/isolated/game');
  assert.equal(sessions.saveScope, scope);
  assert.notEqual(first.sessionId, sessions.ref.sessionId);
  assert.ok(sessions.ref.epoch > first.epoch);
  assert.equal(signal.aborted, true);
  assert.throws(() => sessions.assertCurrent(first), /세션.*변경/);
  assert.ok(sessions.matches(sessions.ref));
  assert.deepEqual(released, ['watcher', 'stream']);
  assert.ok(!JSON.stringify(sessions.ref).includes('C:/isolated'));
  await sessions.close();
});

test('concurrent transitions release every client and watcher exactly once', async () => {
  const sessions = new DesktopProjectSessions();
  let stopsA = 0,
    stopsB = 0;
  const a = {
    credentials: { projectId: 'a' },
    state: { memberId: 'member-a' },
    stop() {
      stopsA++;
    },
  };
  const b = {
    credentials: { projectId: 'b' },
    state: { memberId: 'member-b' },
    stop() {
      stopsB++;
    },
  };
  await Promise.all([
    sessions.activate('cache-a', a),
    sessions.activate('cache-b', b),
  ]);
  assert.equal(sessions.client, b);
  assert.equal(sessions.saveScope, 'shared:b:member-b');
  assert.equal(stopsA, 1);
  await Promise.all([sessions.close(), sessions.close()]);
  assert.equal(stopsB, 1);
  assert.equal(sessions.root, null);
});

test('resource failures abort the lifetime, attempt all cleanup and never activate a different project', async () => {
  const sessions = new DesktopProjectSessions();
  await sessions.activate('original');
  const first = sessions.ref;
  let cleaned = false;
  sessions.own('one', () => {
    cleaned = true;
  });
  sessions.own('two', () => {
    throw Error('watcher failed');
  });
  await assert.rejects(sessions.activate('other'), AggregateError);
  assert.ok(cleaned);
  assert.equal(sessions.root, 'original');
  assert.throws(() => sessions.assertCurrent(first), /세션.*변경/);
});

test('session disposer is idempotent and released resources stay released', async () => {
  const session = new ProjectSession(
    { projectKey: 'opaque', sessionId: 'one', epoch: 1 },
    'local',
    'local-id',
  );
  let calls = 0;
  session.own('removed', () => {
    throw Error('already released');
  });
  session.release('removed');
  session.own('active', () => {
    calls++;
  });
  await Promise.all([session.dispose(), session.dispose()]);
  assert.equal(calls, 1);
  assert.throws(() => session.own('late', () => {}), /종료/);
});

test('home, close and update checkpoint share the same ordering and preserve errors for retry', async () => {
  const events = [];
  let fail = true;
  const lifecycle = new DesktopLifecycle({
    drafts: async () => {
      events.push('drafts');
    },
    saves: async () => {
      events.push('saves');
      if (fail) throw Error('disk full');
    },
    cache: async () => {
      events.push('cache');
    },
  });
  const one = lifecycle.preserve('home'),
    two = lifecycle.preserve('window-close');
  assert.equal(one, two);
  await assert.rejects(one, /disk full/);
  assert.deepEqual(events, ['drafts', 'saves']);
  fail = false;
  await lifecycle.preserve('update-restart');
  assert.deepEqual(events, ['drafts', 'saves', 'drafts', 'saves', 'cache']);
});
