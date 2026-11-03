import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  locationLinkHref,
  parseLocationLink,
  resolveLocationItem,
  locationViewport,
} from '../src/core/projects/location-links.ts';
import { LocationLinkService } from '../src/application/projects/location-link-service.ts';
import { LocationLinkInbox } from '../src/desktop/location-link-inbox.ts';
import { locationIndex } from '../src/adapters/markdown/location-index.ts';

const projectId = '11111111-1111-4111-8111-111111111111';
const target = { kind: 'document', id: '문서 a/한글' };
const href = locationLinkHref({ version: 1, projectId, target });
test('versioned links round-trip all target kinds without credentials and preserve legacy separation', () => {
  for (const kind of ['document', 'drawing', 'html', 'file']) {
    const value = {
      version: 1,
      projectId,
      target: { kind, id: kind === 'file' ? 'docs/한글.md' : 'id-01' },
    };
    assert.deepEqual(parseLocationLink(locationLinkHref(value)), value);
  }
  assert.deepEqual(parseLocationLink(href), { version: 1, projectId, target });
  assert.deepEqual(
    parseLocationLink(href.replace('open?', 'open/?')),
    parseLocationLink(href),
    'Windows URL canonicalization',
  );
  for (const raw of [
    'gamejam://document/a',
    href + '&token=secret',
    href + '&project=other',
    href.replace('v=1', 'v=2'),
    href + '#fragment',
    href.replace('id=', 'id=%QQ'),
    href.replace('kind=document', 'kind=exe'),
    'https://example.com',
    href + '&__proto__=x',
    href.replace('id=', 'id=%0A'),
  ])
    assert.throws(() => parseLocationLink(raw));
  for (const id of ['../x', '/x', 'C:/x', 'docs\\x', 'a//b', 'a/./b'])
    assert.throws(() =>
      locationLinkHref({ version: 1, projectId, target: { kind: 'file', id } }),
    );
});
test('identity resolution follows the current canvas and rejects deleted and ambiguous identities', () => {
  const item = { target, canvasId: 'moved' };
  assert.equal(resolveLocationItem(target, [item]), item);
  assert.throws(() => resolveLocationItem(target, []), /삭제/);
  assert.throws(
    () => resolveLocationItem(target, [item, { ...item, canvasId: 'other' }]),
    /구분/,
  );
  assert.equal(
    resolveLocationItem({ kind: 'file', id: 'docs/a.md' }, [
      { ...item, relativePath: 'docs/a.md' },
    ]).canvasId,
    'moved',
  );
});
test('viewport fits extreme and narrow images completely, caps small-object zoom and uses readable document height', () => {
  for (const bounds of [
    { x: -100, y: 20, width: 100000, height: 100000 },
    { x: 10, y: -40, width: 1, height: 100000 },
    { x: 1e6, y: 1e6, width: 1, height: 1 },
    { x: 0, y: 0, width: 0, height: 0 },
  ]) {
    const viewport = locationViewport(bounds, 900, 600);
    assert.ok(viewport.zoom > 0 && viewport.zoom <= 1);
    assert.ok(bounds.x * viewport.zoom + viewport.x >= 63);
    assert.ok(bounds.y * viewport.zoom + viewport.y >= 63);
    assert.ok((bounds.x + bounds.width) * viewport.zoom + viewport.x <= 837);
    assert.ok((bounds.y + bounds.height) * viewport.zoom + viewport.y <= 537);
  }
  assert.ok(
    locationViewport({ x: 0, y: 0, width: 100000, height: 100000 }, 900, 600)
      .zoom < 0.15,
  );
  assert.equal(
    locationViewport({ x: 0, y: 0, width: 400, height: 100000 }, 900, 600, true)
      .zoom,
    1,
  );
  assert.throws(() =>
    locationViewport({ x: Infinity, y: 0, width: 1, height: 1 }, 900, 600),
  );
});
function fixture() {
  const item = { target, canvasId: 'default' };
  let state = { projectId, key: 'session-1' },
    verify = async () => {},
    ready = true;
  const calls = [];
  const entries = [{ id: 'saved', kind: 'shared', projectId, current: true }];
  const service = new LocationLinkService({
    projects: () => entries,
    hasSession: () => true,
    current: () => state,
    verify: async (id) => {
      calls.push(['verify', id]);
      await verify();
    },
    open: async (id) => {
      calls.push(['open', id]);
      return { root: 'private' };
    },
    workspace: () => ({ root: 'private' }),
    items: () => [item],
    assertReady: () => {
      if (!ready) throw Error('offline');
    },
  });
  return {
    service,
    entries,
    calls,
    setVerify(fn) {
      verify = fn;
    },
    setState(next) {
      state = next;
    },
    setReady(next) {
      ready = next;
    },
  };
}
test('opening and issuing links verify stored membership online and never auto-join', async () => {
  const f = fixture();
  assert.equal(await f.service.create(target), href);
  assert.equal((await f.service.open(href)).item.canvasId, 'default');
  assert.deepEqual(f.calls, [
    ['verify', 'saved'],
    ['verify', 'saved'],
    ['open', 'saved'],
  ]);
  f.setVerify(async () => {
    throw Error('revoked');
  });
  await assert.rejects(f.service.open(href), /revoked/);
  assert.equal(f.calls.filter((x) => x[0] === 'open').length, 1);
  f.entries.length = 0;
  await assert.rejects(f.service.open(href), /참여/);
});
test('stale sessions, duplicate connections, offline writes and lifecycle block navigation', async () => {
  const f = fixture();
  f.setVerify(async () => {
    f.setState({ projectId, key: 'session-2' });
  });
  await assert.rejects(f.service.open(href), /변경/);
  assert.ok(!f.calls.some((x) => x[0] === 'open'));
  const g = fixture();
  g.entries[0].current = false;
  g.entries.push({ id: 'other-server', kind: 'shared', projectId });
  await assert.rejects(g.service.open(href), /여러/);
  await g.service.open(href, 'saved');
  g.entries[0].lifecycle = { status: 'trashed' };
  await assert.rejects(g.service.open(href, 'saved'), /휴지통/);
  const h = fixture();
  h.setReady(false);
  await assert.rejects(h.service.create(target), /offline/);
  assert.equal(h.calls.length, 0);
});
test('inbox retains newest intent across early startup and ignores an old acknowledgement', () => {
  let notifications = 0;
  const inbox = new LocationLinkInbox(() => notifications++);
  inbox.receive(href);
  const first = inbox.pending();
  inbox.receive(href);
  assert.equal(notifications, 1);
  const newer = locationLinkHref({
    version: 1,
    projectId,
    target: { kind: 'drawing', id: 'b' },
  });
  inbox.receive(newer);
  inbox.acknowledge(first.id);
  assert.equal(inbox.pending().href, newer);
  inbox.acknowledge(inbox.pending().id);
  assert.equal(inbox.pending(), null);
});
test('server snapshot index identifies markdown, imported images and stable HTML source IDs', () => {
  const files = {
    'docs/a.md':
      '---\nid: doc-a\ntitle: 문서\ntype: idea\ncanvas_id: other\n---\n본문\n',
    'output/index.html': '<!doctype html><html><body>demo</body></html>',
  };
  const items = locationIndex(files);
  assert.equal(
    items.find((item) => item.target.id === 'doc-a').canvasId,
    'other',
  );
  assert.ok(items.find((item) => item.target.kind === 'html').target.id);
  assert.equal(
    items.find((item) => item.target.kind === 'html').relativePath,
    'output/index.html',
  );
});
