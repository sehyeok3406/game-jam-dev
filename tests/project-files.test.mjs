import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { SharedProjectMirror } from '../src/application/editing/shared-project-mirror.ts';
import { filesystemSharedProjectFiles } from '../src/adapters/filesystem/shared-project-files.ts';
import {
  sessionProjectFileEffects,
  startSessionProjectWatcher,
} from '../src/desktop/project-file-effects.ts';
import { captureProject, materialize } from '../src/project-store.ts';
import { reduceCollaboration } from '../src/collaboration-model.ts';
import { previewWindowPath } from '../src/preview-output.ts';

function fixture() {
  let current = true;
  const calls = [],
    before = { 'ideas/a.md': 'old', 'ideas/removed.md': 'removed' };
  const mark =
    (name, result) =>
    async (...args) => {
      calls.push([name, ...args]);
      return result;
    };
  const files = {
    ensure: mark('ensure'),
    capture: mark('capture', before),
    move: mark('move', {
      baseline: before,
      rollback: mark('rollback'),
      finish: mark('finish'),
    }),
    apply: mark('apply'),
    trash: mark('trash'),
    cleanup: mark('cleanup'),
  };
  const assertCurrent = () => {
    if (!current) throw Error('stale session');
  };
  return {
    files,
    calls,
    before,
    assertCurrent,
    expire: () => (current = false),
    mirror: new SharedProjectMirror(files, assertCurrent),
  };
}
test('shared mirror freezes target before awaits, keeps removal tombstones and commits before disposal', async () => {
  const f = fixture(),
    target = { 'ideas/a.md': 'new' };
  f.files.ensure = async () => {
    target['ideas/a.md'] = 'late change';
  };
  await f.mirror.sync(target);
  assert.deepEqual(
    f.calls.map(([n]) => n),
    ['capture', 'move', 'apply', 'finish', 'trash', 'cleanup'],
  );
  assert.deepEqual(f.calls.find(([n]) => n === 'apply')[2], {
    'ideas/a.md': 'new',
    'ideas/removed.md': null,
  });
  assert.equal(f.calls.find(([n]) => n === 'trash')[2]['ideas/a.md'], 'new');
});
for (const stage of ['ensure', 'capture', 'move']) {
  test(`shared mirror ${stage} failure prevents commit and disposal`, async () => {
    const f = fixture();
    f.files[stage] = async () => {
      throw Error('injected');
    };
    await assert.rejects(f.mirror.sync({}), /injected/);
    assert.ok(
      !f.calls.some(([n]) => ['apply', 'trash', 'cleanup'].includes(n)),
    );
  });
}
test('failed metadata commit rolls back folders before resuming watcher and never disposes files', async () => {
  const f = fixture();
  f.files.apply = async () => {
    f.calls.push(['failed-apply']);
    throw Error('disk full');
  };
  await assert.rejects(f.mirror.sync({}), /disk full/);
  assert.deepEqual(
    f.calls.map(([n]) => n),
    ['ensure', 'capture', 'move', 'failed-apply', 'rollback', 'finish'],
  );
});
test('session change after move rolls back only the captured move and never writes metadata', async () => {
  const f = fixture(),
    move = f.files.move;
  f.files.move = async (...args) => {
    const result = await move(...args);
    f.expire();
    return result;
  };
  await assert.rejects(f.mirror.sync({}), /stale session/);
  assert.deepEqual(
    f.calls.map(([n]) => n),
    ['ensure', 'capture', 'move', 'rollback', 'finish'],
  );
});
test('session change after successful commit does not undo physical folders alone', async () => {
  const f = fixture();
  f.files.apply = async () => {
    f.calls.push(['committed']);
    f.expire();
  };
  await assert.rejects(f.mirror.sync({}), /stale session/);
  assert.deepEqual(
    f.calls.map(([n]) => n),
    ['ensure', 'capture', 'move', 'committed', 'finish'],
  );
});
for (const stage of ['trash', 'cleanup']) {
  test(`post-commit ${stage} failure is reported without reversing a committed folder move`, async () => {
    const f = fixture();
    f.files[stage] = async () => {
      throw Error('injected');
    };
    await assert.rejects(f.mirror.sync({}), /injected/);
    assert.ok(f.calls.some(([n]) => n === 'apply'));
    assert.ok(!f.calls.some(([n]) => n === 'rollback'));
  });
}
test('trash-only application operation rejects stale scope without starting native work', async () => {
  const f = fixture();
  f.expire();
  await assert.rejects(f.mirror.trash({}, {}), /stale session/);
  assert.equal(f.calls.length, 0);
});

function watcherFixture() {
  let current = true,
    watcher;
  const calls = [],
    original = {
      close: async () => {
        calls.push('close');
      },
    };
  watcher = original;
  const ports = {
    assertCurrent: () => {
      if (!current) throw Error('stale');
    },
    isCurrent: () => current,
    watcher: () => watcher,
    clear: () => {
      calls.push('clear');
      watcher = null;
    },
    restart: async () => {
      calls.push('restart');
      watcher = original;
    },
    trashItem: async () => {
      calls.push('trash');
    },
  };
  return {
    calls,
    ports,
    original,
    effects: sessionProjectFileEffects(ports),
    expire: () => (current = false),
    replace: (value) => (watcher = value),
    get watcher() {
      return watcher;
    },
  };
}
test('watcher pause/resume is idempotent and absent watchers are not started', async () => {
  const f = watcherFixture(),
    resume = await f.effects.pauseWatcher();
  assert.equal(f.watcher, null);
  await resume();
  await resume();
  assert.deepEqual(f.calls, ['close', 'clear', 'restart']);
  f.calls.length = 0;
  f.replace(null);
  await (
    await f.effects.pauseWatcher()
  )();
  assert.equal(f.calls.length, 0);
});
test('late watcher finalizer cannot restart or clear another session', async () => {
  const f = watcherFixture(),
    resume = await f.effects.pauseWatcher(),
    replacement = { close: async () => {} };
  f.expire();
  f.replace(replacement);
  await resume();
  assert.equal(f.watcher, replacement);
  assert.deepEqual(f.calls, ['close', 'clear']);
  await assert.rejects(f.effects.trashItem('old-path'), /stale/);
  assert.ok(!f.calls.includes('trash'));
});
test('session replacement during asynchronous watcher close leaves the new watcher intact', async () => {
  const f = watcherFixture(),
    replacement = { close: async () => {} };
  f.original.close = async () => {
    f.expire();
    f.replace(replacement);
  };
  await assert.rejects(f.effects.pauseWatcher(), /stale/);
  assert.equal(f.watcher, replacement);
  assert.equal(f.calls.length, 0);
});

test('watcher installation rechecks session after asynchronous close and cannot replace a new watcher', async () => {
  let current = true,
    changed = 0;
  const replacement = { close: async () => {} };
  let watcher = {
    close: async () => {
      current = false;
      watcher = replacement;
    },
  };
  await startSessionProjectWatcher('/old', {
    isCurrent: () => current,
    watcher: () => watcher,
    set: (value) => {
      watcher = value;
    },
    create: () => {
      throw Error('must not watch old root');
    },
    changed: () => changed++,
  });
  assert.equal(watcher, replacement);
  assert.equal(changed, 0);
});
test('installed watcher retains original root and ignores events after the session closes', async () => {
  let current = true,
    callback,
    changed = 0,
    watcher = null;
  await startSessionProjectWatcher('/captured', {
    isCurrent: () => current,
    watcher: () => watcher,
    set: (value) => {
      watcher = value;
    },
    create: (root) => {
      assert.equal(root, '/captured');
      return {
        close: async () => {},
        on: (event, listener) => {
          assert.equal(event, 'all');
          callback = listener;
        },
      };
    },
    changed: () => changed++,
  });
  callback();
  assert.equal(changed, 1);
  current = false;
  callback();
  assert.equal(changed, 1);
});

const html = '<!doctype html><html><body>preserved HTML</body></html>';
const from = 'output/inbox/original/v001/index.html';
const movedPath = 'output/systems/moved/v001/index.html';
async function nativeFixture(t) {
  const temporary = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-mirror-')),
  );
  t.after(async () => {
    assert.ok(
      temporary.startsWith((await fs.realpath(os.tmpdir())) + path.sep),
    );
    await fs.rm(temporary, { recursive: true, force: true });
  });
  const root = path.join(temporary, 'original'),
    other = path.join(temporary, 'new-session');
  await fs.mkdir(root);
  await fs.mkdir(other);
  const initial = {
    'project.md': matter.stringify('원본 본문', {
      id: 'project',
      title: 'original',
      custom: 'keep',
    }),
    [from]: html,
  };
  await materialize(root, initial);
  const asset = path.join(root, path.dirname(from), 'assets/game.js');
  await fs.mkdir(path.dirname(asset), { recursive: true });
  await fs.writeFile(asset, 'original auxiliary script');
  await fs.writeFile(
    path.join(path.dirname(asset), 'local.log'),
    'untracked local notes',
  );
  const synchronized = await captureProject(root);
  const window = await import('../src/project-store.ts').then((m) =>
    m.projectPath(root, previewWindowPath(from)),
  );
  await fs.mkdir(path.dirname(window), { recursive: true });
  await fs.writeFile(window, '{"width":777}');
  let current = true;
  const assertCurrent = () => {
    if (!current) throw Error('stale native session');
  };
  const trashed = [],
    effects = {
      pauseWatcher: async () => async () => {},
      trashItem: async (absolute) => {
        assert.ok(
          path.resolve(absolute).startsWith(path.resolve(root) + path.sep),
        );
        const destination = path.join(temporary, `trash-${trashed.length}`);
        await fs.rename(absolute, destination);
        trashed.push({ absolute, destination });
      },
    };
  const files = filesystemSharedProjectFiles(root, effects, assertCurrent);
  const after = reduceCollaboration(synchronized, 'results:move', {
    relativePath: from,
    category: 'systems',
    feature: 'moved',
  }).files;
  const destination = Object.keys(after).find((key) =>
    key.endsWith('/index.html'),
  );
  assert.equal(destination, movedPath);
  return {
    root,
    other,
    initial,
    after,
    files,
    trashed,
    assertCurrent,
    expire: () => (current = false),
    mirror: new SharedProjectMirror(files, assertCurrent),
  };
}
test('native shared mirror moves tracked assets and personal window state; disposal retains untracked auxiliary bytes', async (t) => {
  const f = await nativeFixture(t);
  await f.mirror.sync(f.after);
  assert.equal(await fs.readFile(path.join(f.root, movedPath), 'utf8'), html);
  const aux = path.join(f.root, path.dirname(movedPath), 'assets/game.js');
  assert.equal(await fs.readFile(aux, 'utf8'), 'original auxiliary script');
  assert.equal(
    await fs.readFile(path.join(f.root, previewWindowPath(movedPath)), 'utf8'),
    '{"width":777}',
  );
  await assert.rejects(fs.access(path.join(f.root, from)), { code: 'ENOENT' });
  const after = reduceCollaboration(f.after, 'documents:delete', {
    relativePath: movedPath,
    documentId: movedPath,
  }).files;
  await f.mirror.sync(after);
  assert.ok(
    f.trashed.some((entry) =>
      entry.absolute.endsWith(path.join('moved', 'v001')),
    ),
  );
  const folder = f.trashed.find((entry) =>
    entry.absolute.endsWith(path.join('moved', 'v001')),
  );
  assert.equal(
    await fs.readFile(
      path.join(folder.destination, 'assets/local.log'),
      'utf8',
    ),
    'untracked local notes',
  );
  assert.equal(
    after[path.posix.join(path.posix.dirname(movedPath), 'assets/game.js')],
    undefined,
  );
  assert.equal(
    await fs.readFile(path.join(f.root, 'project.md'), 'utf8'),
    f.initial['project.md'],
  );
});
test('native failed apply restores moved result, sidecar and auxiliary files at original root', async (t) => {
  const f = await nativeFixture(t);
  f.files.apply = async () => {
    throw Error('disk injected');
  };
  await assert.rejects(f.mirror.sync(f.after), /disk injected/);
  assert.equal(await fs.readFile(path.join(f.root, from), 'utf8'), html);
  assert.equal(
    await fs.readFile(
      path.join(f.root, path.dirname(from), 'assets/game.js'),
      'utf8',
    ),
    'original auxiliary script',
  );
  assert.equal(
    await fs.readFile(path.join(f.root, previewWindowPath(from)), 'utf8'),
    '{"width":777}',
  );
  assert.equal(f.trashed.length, 0);
  assert.deepEqual(await fs.readdir(f.other), []);
});
test('native session change after folder move rolls back old root without touching newly opened project', async (t) => {
  const f = await nativeFixture(t),
    move = f.files.move;
  f.files.move = async (...args) => {
    const result = await move(...args);
    f.expire();
    return result;
  };
  await assert.rejects(f.mirror.sync(f.after), /stale native session/);
  assert.equal(await fs.readFile(path.join(f.root, from), 'utf8'), html);
  assert.deepEqual(await fs.readdir(f.other), []);
  assert.equal(f.trashed.length, 0);
});
test('native mirror rejects an external edit during atomic apply and preserves both the edit and moved assets', async (t) => {
  const f = await nativeFixture(t),
    apply = f.files.apply;
  f.files.apply = async (...args) => {
    await fs.writeFile(path.join(f.root, 'project.md'), 'external edit');
    return apply(...args);
  };
  await assert.rejects(f.mirror.sync(f.after), /변경|충돌/);
  assert.equal(
    await fs.readFile(path.join(f.root, 'project.md'), 'utf8'),
    'external edit',
  );
  assert.equal(await fs.readFile(path.join(f.root, from), 'utf8'), html);
  assert.equal(f.trashed.length, 0);
});
