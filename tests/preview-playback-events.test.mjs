import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PreviewPlaybackEvents,
  previewPlaybackEvents,
} from '../src/ui/preview/playback-events.ts';

function target() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn) {
      listeners.get(name)?.delete(fn);
    },
    emit(name, event = {}) {
      for (const fn of listeners.get(name) ?? []) fn(event);
    },
    count(name) {
      return listeners.get(name)?.size ?? 0;
    },
  };
}
function fixture() {
  const host = target(),
    doc = { ...target(), defaultView: host, fullscreenElement: null, exits: 0 };
  doc.exitFullscreen = async () => {
    doc.exits++;
    doc.fullscreenElement = null;
    doc.emit('fullscreenchange');
  };
  const owner = (id) => {
    const notifications = [],
      diagnostics = [],
      messages = [];
    return {
      id,
      card: { id },
      frame: {
        contentWindow: { postMessage: (value) => messages.push(value) },
      },
      fullscreen: (active) => notifications.push(active),
      diagnostic: (value) => diagnostics.push(value),
      notifications,
      diagnostics,
      messages,
    };
  };
  return { host, doc, owner, events: new PreviewPlaybackEvents(doc) };
}

test('30 game windows share listeners and diagnostics require both the frame source and id', () => {
  const { host, doc, owner, events } = fixture();
  const owners = Array.from({ length: 30 }, (_, i) => owner(String(i)));
  const stops = owners.map((o) => events.register(o));
  assert.equal(host.count('message'), 1);
  assert.equal(host.count('keydown'), 1);
  assert.equal(doc.count('fullscreenchange'), 1);
  const sender = owners[7],
    message = {
      source: sender.frame.contentWindow,
      data: {
        id: sender.id,
        type: 'gamejam:diagnostic',
        diagnostic: { ok: true },
      },
    };
  host.emit('message', { ...message, source: {} });
  host.emit('message', { ...message, data: { ...message.data, id: '8' } });
  host.emit('message', { ...message, data: null });
  assert.equal(owners.flatMap((o) => o.diagnostics).length, 0);
  host.emit('message', message);
  assert.deepEqual(sender.diagnostics, [{ ok: true }]);
  assert.equal(owners.flatMap((o) => o.diagnostics).length, 1);
  stops.forEach((stop) => stop());
  assert.equal(host.count('message'), 0);
  assert.equal(host.count('keydown'), 0);
  assert.equal(doc.count('fullscreenchange'), 0);
});

test('fullscreen notifications and Escape target only the owner, including transfers and unrelated fullscreen', () => {
  const { host, doc, owner, events } = fixture(),
    a = owner('a'),
    b = owner('b'),
    c = owner('c');
  [a, b, c].forEach((o) => events.register(o));
  doc.fullscreenElement = a.card;
  doc.emit('fullscreenchange');
  doc.emit('fullscreenchange');
  assert.deepEqual(a.notifications, [false, true]);
  assert.deepEqual(b.notifications, [false]);
  doc.fullscreenElement = b.card;
  doc.emit('fullscreenchange');
  assert.deepEqual(a.notifications, [false, true, false]);
  assert.deepEqual(b.notifications, [false, true]);
  assert.deepEqual(c.messages, []);
  host.emit('message', {
    source: a.frame.contentWindow,
    data: { id: 'a', type: 'game-canvas:preview-escape' },
  });
  host.emit('message', {
    source: b.frame.contentWindow,
    data: { id: 'a', type: 'game-canvas:preview-escape' },
  });
  assert.equal(doc.exits, 0);
  host.emit('message', {
    source: b.frame.contentWindow,
    data: { id: 'b', type: 'game-canvas:preview-escape' },
  });
  assert.equal(doc.exits, 1);
  assert.equal(b.messages.at(-1).active, false);
  doc.fullscreenElement = c.card;
  doc.emit('fullscreenchange');
  host.emit('keydown', { key: 'Enter' });
  assert.equal(doc.exits, 1);
  host.emit('keydown', { key: 'Escape' });
  assert.equal(doc.exits, 2);
  doc.fullscreenElement = { other: true };
  doc.emit('fullscreenchange');
  host.emit('keydown', { key: 'Escape' });
  assert.equal(doc.exits, 2);
});

test('replacement and restart cleanup cannot unregister a newer frame owner or route stale messages', () => {
  const { host, doc, owner, events } = fixture(),
    old = owner('old'),
    next = owner('next');
  next.frame = old.frame;
  const stopOld = events.register(old),
    stopNext = events.register(next);
  stopOld();
  assert.equal(host.count('message'), 1);
  host.emit('message', {
    source: next.frame.contentWindow,
    data: { id: 'old', type: 'gamejam:diagnostic', diagnostic: 1 },
  });
  host.emit('message', {
    source: next.frame.contentWindow,
    data: { id: 'next', type: 'gamejam:diagnostic', diagnostic: 2 },
  });
  assert.deepEqual(old.diagnostics, []);
  assert.deepEqual(next.diagnostics, [2]);
  doc.fullscreenElement = old.card;
  doc.emit('fullscreenchange');
  assert.deepEqual(next.notifications, [false]);
  stopNext();
  const restarted = owner('next'),
    stopRestarted = events.register(restarted);
  host.emit('message', {
    source: next.frame.contentWindow,
    data: { id: 'next', type: 'gamejam:diagnostic', diagnostic: 3 },
  });
  assert.deepEqual(restarted.diagnostics, []);
  stopNext();
  assert.equal(host.count('message'), 1);
  stopRestarted();
  assert.equal(host.count('message'), 0);
});

test('document registries are isolated and reconnect after the last owner leaves', () => {
  const a = fixture(),
    b = fixture();
  assert.equal(previewPlaybackEvents(a.doc), previewPlaybackEvents(a.doc));
  assert.notEqual(previewPlaybackEvents(a.doc), previewPlaybackEvents(b.doc));
  const events = previewPlaybackEvents(a.doc),
    stop = events.register(a.owner('first'));
  stop();
  assert.equal(a.host.count('message'), 0);
  const stopNext = events.register(a.owner('second'));
  assert.equal(a.host.count('message'), 1);
  assert.equal(b.host.count('message'), 0);
  stopNext();
});
