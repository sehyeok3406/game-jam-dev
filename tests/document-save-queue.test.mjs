import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DocumentSaveQueue } from '../src/document-save-queue.ts';
import { DocumentSaveStore } from '../src/document-save-store.ts';

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const tick = () => new Promise((r) => setImmediate(r));
const doc = (body = 'base', id = 'note') => ({
  id,
  relativePath: 'ideas/note.md',
  title: 'Note',
  body,
  revision: 1,
  contentRevision: 1,
  modifiedAt: 1,
});
const request = (sequence, body, scope = 'one', key = 'note') => ({
  scope,
  key,
  documentId: 'note',
  relativePath: 'ideas/note.md',
  title: 'Note',
  body,
  sequence,
  base: { title: 'Note', body: 'base' },
});
function memory(records = []) {
  const data = new Map(
    records.map((r) => [
      JSON.stringify([r.request.scope, r.request.key]),
      structuredClone(r),
    ]),
  );
  return {
    data,
    load: async () => [...data.values()].map((r) => structuredClone(r)),
    put: async (r) => {
      data.set(
        JSON.stringify([r.request.scope, r.request.key]),
        structuredClone(r),
      );
    },
    remove: async (scope, key) => {
      data.delete(JSON.stringify([scope, key]));
    },
    flush: async () => {},
  };
}
const adapter = (read, write, extra = {}) => ({
  scope: 'one',
  isCurrent: () => true,
  canSend: () => true,
  read,
  write,
  ...extra,
});

test('a delayed UI acknowledgement cannot reset the queue baseline to stale text', async () => {
  let server = doc();
  const writes = [];
  const queue = new DocumentSaveQueue(memory());
  try {
    await queue.activate(
      adapter(
        async () => structuredClone(server),
        async (input) => {
          writes.push(input);
          server = { ...server, body: input.body };
          return structuredClone(server);
        },
      ),
    );
    await queue.enqueue({ ...request(1, 'first'), sessionId: 'editor' });
    await queue.flush('one');
    // The renderer has not received the first ACK, so its base is still "base".
    await queue.enqueue({ ...request(2, 'second'), sessionId: 'editor' });
    await queue.flush('one');
    assert.equal(server.body, 'second');
    assert.equal(writes[1].expectedBody, 'first');
  } finally {
    queue.dispose();
  }
});

test('a new edit session may adopt current server text after its previous job completed', async () => {
  let server = doc();
  const queue = new DocumentSaveQueue(memory());
  try {
    await queue.activate(
      adapter(
        async () => structuredClone(server),
        async (input) => {
          server = { ...server, body: input.body };
          return structuredClone(server);
        },
      ),
    );
    await queue.enqueue({ ...request(1, 'first'), sessionId: 'old-editor' });
    await queue.flush('one');
    server = doc('external change');
    await queue.enqueue({
      ...request(2, 'new edit'),
      sessionId: 'new-editor',
      base: { title: 'Note', body: 'external change' },
    });
    await queue.flush('one');
    assert.equal(server.body, 'new edit');
    // A second external change during that session still blocks writes.
    server = doc('another external change');
    await queue.enqueue({
      ...request(3, 'my next edit'),
      sessionId: 'new-editor',
      base: { title: 'Note', body: 'another external change' },
    });
    await assert.rejects(queue.flush('one'), /변경/);
    assert.equal(server.body, 'another external change');
  } finally {
    queue.dispose();
  }
});

test('discarding a conflict notifies observers and allows explicit draft recovery on the latest text', async () => {
  let server = doc('external');
  const states = [],
    storage = memory();
  const queue = new DocumentSaveQueue(storage, (state) => states.push(state));
  try {
    await queue.activate(
      adapter(
        async () => server,
        async (input) => (server = { ...server, body: input.body }),
      ),
    );
    await queue.enqueue(request(1, 'my draft'));
    await assert.rejects(queue.flush('one'), /변경/);
    await assert.rejects(queue.discard('one', 'note', 2), /변경/);
    await queue.discard('one', 'note', 1);
    assert.equal(states.at(-1).phase, 'discarded');
    assert.deepEqual(await queue.list('one'), []);
    assert.equal(storage.data.size, 0);
    await queue.enqueue({
      ...request(2, 'recovered draft'),
      base: { title: 'Note', body: 'external' },
    });
    await queue.flush('one');
    assert.equal(server.body, 'recovered draft');
  } finally {
    queue.dispose();
  }
});

test('in-flight snapshot stays immutable; unsent saves compact and older ACKs never acknowledge newer edits', async () => {
  const started = deferred(),
    release = deferred(),
    writes = [],
    states = [];
  let server = doc();
  const queue = new DocumentSaveQueue(memory(), (s) => states.push(s));
  try {
    await queue.activate(
      adapter(
        async () => structuredClone(server),
        async (input) => {
          writes.push(structuredClone(input));
          if (writes.length === 1) {
            started.resolve();
            await release.promise;
          }
          server = {
            ...server,
            title: input.title,
            body: input.body,
            revision: server.revision + 1,
          };
          return structuredClone(server);
        },
      ),
    );
    await queue.enqueue(request(1, 'first'));
    await started.promise;
    await queue.enqueue(request(2, 'middle'));
    await queue.enqueue(request(3, 'latest'));
    assert.equal((await queue.list('one'))[0].savedSequence, 0);
    release.resolve();
    await queue.flush('one', 'note');
    assert.deepEqual(
      writes.map((w) => w.body),
      ['first', 'latest'],
    );
    assert.equal(writes[1].expectedBody, 'first');
    assert.ok(
      states.some(
        (s) => s.savedSequence === 1 && s.sequence === 3 && s.phase !== 'saved',
      ),
    );
    assert.equal((await queue.list('one'))[0].savedSequence, 3);
  } finally {
    queue.dispose();
  }
});

test('offline queue survives a new process and resumes only in its original project', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gc-document-queue-'),
  );
  const first = new DocumentSaveQueue(new DocumentSaveStore(directory));
  let connected = false,
    server = doc(),
    writes = 0;
  try {
    await first.activate(
      adapter(
        async () => server,
        async () => assert.fail('offline write'),
        { canSend: () => false },
      ),
    );
    await first.enqueue(request(4, 'recovered'));
    assert.equal((await first.flush('one', 'note'))[0].phase, 'offline');
    await first.checkpoint();
    first.dispose();
    const next = new DocumentSaveQueue(new DocumentSaveStore(directory));
    try {
      await next.activate(
        adapter(
          async () => server,
          async () => assert.fail('wrong project'),
          { scope: 'two' },
        ),
      );
      await tick();
      assert.equal(writes, 0);
      connected = true;
      await next.activate(
        adapter(
          async () => server,
          async (input) => {
            writes++;
            server = { ...server, body: input.body };
            return server;
          },
          { canSend: () => connected },
        ),
      );
      await next.flush('one', 'note');
      assert.equal(server.body, 'recovered');
      assert.equal(writes, 1);
    } finally {
      next.dispose();
    }
  } finally {
    first.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('crash after the server commits an attempt reconciles that attempt before sending newer content', async () => {
  const record = {
    request: request(3, 'latest'),
    base: { title: 'Note', body: 'base' },
    savedSequence: 0,
    attempt: { title: 'Note', body: 'first', sequence: 1 },
    phase: 'saving',
  };
  let server = doc('first');
  const writes = [];
  const queue = new DocumentSaveQueue(memory([record]));
  try {
    await queue.activate(
      adapter(
        async () => server,
        async (input) => {
          writes.push(input);
          server = { ...server, body: input.body };
          return server;
        },
      ),
    );
    await queue.flush('one');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].expectedBody, 'first');
    assert.equal(server.body, 'latest');
  } finally {
    queue.dispose();
  }
});

test('switching projects during a read prevents cross-project writes; flush waits for the resumed worker', async () => {
  const started = deferred(),
    releaseRead = deferred(),
    releaseWrite = deferred(),
    writeStarted = deferred();
  let server = doc(),
    firstRead = true,
    writes = 0,
    flushed = false;
  const queue = new DocumentSaveQueue(memory());
  const projectOne = () =>
    adapter(
      async () => {
        if (firstRead) {
          firstRead = false;
          started.resolve();
          await releaseRead.promise;
        }
        return structuredClone(server);
      },
      async (input) => {
        writes++;
        writeStarted.resolve();
        await releaseWrite.promise;
        server = { ...server, body: input.body };
        return structuredClone(server);
      },
    );
  try {
    await queue.activate(projectOne());
    await queue.enqueue(request(1, 'resumed draft'));
    await started.promise;
    await queue.activate(
      adapter(
        async () => doc(),
        async () => assert.fail('wrong project'),
        { scope: 'two' },
      ),
    );
    await queue.activate(projectOne());
    const flush = queue.flush('one').then(() => {
      flushed = true;
    });
    releaseRead.resolve();
    await writeStarted.promise;
    await tick();
    assert.equal(
      flushed,
      false,
      'flush cannot acknowledge the obsolete worker',
    );
    releaseWrite.resolve();
    await flush;
    assert.equal(writes, 1);
    assert.equal(server.body, 'resumed draft');
    assert.equal((await queue.list('one'))[0].phase, 'saved');
  } finally {
    releaseRead.resolve();
    releaseWrite.resolve();
    queue.dispose();
  }
});

test('foreign text or document replacement preserves the draft and blocks writes', async () => {
  for (const server of [doc('other person'), doc('base', 'replacement')]) {
    const storage = memory();
    const queue = new DocumentSaveQueue(storage);
    try {
      await queue.activate(
        adapter(
          async () => server,
          async () => assert.fail('must not overwrite foreign content'),
        ),
      );
      await queue.enqueue(request(1, 'my draft'));
      await assert.rejects(queue.flush('one'), /변경|이동|삭제/);
      assert.equal((await queue.list('one'))[0].phase, 'conflict');
      assert.equal([...storage.data.values()][0].request.body, 'my draft');
    } finally {
      queue.dispose();
    }
  }
});

test('failed transmission keeps its exact attempt and later retries without losing newer text', async () => {
  let server = doc(),
    connected = true,
    count = 0;
  const queue = new DocumentSaveQueue(memory());
  try {
    await queue.activate(
      adapter(
        async () => server,
        async (input) => {
          count++;
          if (count === 1) {
            connected = false;
            throw Error('ECONNRESET');
          }
          server = { ...server, body: input.body };
          return server;
        },
        { canSend: () => connected },
      ),
    );
    await queue.enqueue(request(1, 'first'));
    await queue.flush('one');
    await queue.enqueue(request(2, 'newer'));
    assert.equal((await queue.flush('one'))[0].phase, 'offline');
    connected = true;
    await queue.flush('one');
    assert.equal(server.body, 'newer');
    assert.equal((await queue.list('one'))[0].phase, 'saved');
  } finally {
    queue.dispose();
  }
});

test('retrying the same edit after a real filesystem failure restores durability before sending', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-save-retry-'));
  const directory = path.join(root, 'queue');
  const queue = new DocumentSaveQueue(new DocumentSaveStore(directory));
  let server = doc(),
    writes = 0;
  try {
    await queue.activate(
      adapter(
        async () => server,
        async (input) => {
          writes++;
          server = { ...server, body: input.body };
          return server;
        },
      ),
    );
    await fs.writeFile(directory, 'blocks mkdir');
    const input = request(1, 'same draft');
    await assert.rejects(queue.enqueue(input), /EEXIST|ENOTDIR/);
    assert.equal(writes, 0);
    await fs.unlink(directory);
    await queue.enqueue(input);
    await queue.flush('one');
    assert.equal(server.body, 'same draft');
    assert.equal(writes, 1);
    const records = await new DocumentSaveStore(directory).load();
    assert.equal(records[0].savedSequence, 1);
  } finally {
    queue.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('local durability failure prevents network transmission; an explicit retry can recover', async () => {
  const storage = memory();
  const original = storage.put;
  let fail = true,
    writes = 0,
    server = doc();
  storage.put = async (record) => {
    if (fail) throw Error('disk full');
    return original(record);
  };
  const queue = new DocumentSaveQueue(storage);
  try {
    await queue.activate(
      adapter(
        async () => server,
        async (input) => {
          writes++;
          server = { ...server, body: input.body };
          return server;
        },
      ),
    );
    await assert.rejects(queue.enqueue(request(1, 'draft')), /disk full/);
    assert.equal(writes, 0);
    fail = false;
    await queue.enqueue(request(2, 'latest'));
    await queue.flush('one');
    assert.equal(writes, 1);
    assert.equal(server.body, 'latest');
  } finally {
    queue.dispose();
  }
});
