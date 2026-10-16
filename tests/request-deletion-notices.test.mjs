import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  deletionNoticeScope,
  deletionUnread,
} from '../src/request-deletion-notices.ts';

test('deletion read receipts survive remount and remain scoped to project, server and author', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null };
  const c = {
    serverUrl: 'https://server.invalid',
    projectId: 'p',
    memberId: 'author',
  };
  const scope = deletionNoticeScope(c);
  const item = {
    id: 'request',
    revision: 3,
    status: 'deleted',
    deletion: { reason: '중복' },
  };
  assert.equal(deletionUnread(storage, scope, item), true);
  values.set(`gamejam-request-deletion-read:${scope}:request`, '3');
  assert.equal(
    deletionUnread(storage, deletionNoticeScope({ ...c }), item),
    false,
  );
  assert.equal(
    deletionUnread(
      storage,
      deletionNoticeScope({ ...c, memberId: 'other' }),
      item,
    ),
    true,
  );
  assert.equal(deletionUnread(storage, scope, { ...item, revision: 4 }), true);
  assert.equal(
    deletionUnread(storage, scope, { ...item, status: 'pending' }),
    false,
  );
  assert.equal(
    deletionUnread(
      {
        getItem: () => {
          throw Error('unavailable');
        },
      },
      scope,
      item,
    ),
    true,
  );
});
