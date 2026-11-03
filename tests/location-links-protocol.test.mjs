import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { installLocationLinkProtocol } from '../src/desktop/location-link-protocol.ts';
import { LocationLinkInbox } from '../src/desktop/location-link-inbox.ts';

const href =
  'gamejam://open?v=1&project=11111111-1111-4111-8111-111111111111&kind=document&id=a';
function setup(lock = true, register = false) {
  const events = [];
  const app = Object.assign(new EventEmitter(), {
    requestSingleInstanceLock: () => lock,
    quit: () => events.push('quit'),
    setAsDefaultProtocolClient: (scheme) => events.push(scheme),
  });
  const inbox = new LocationLinkInbox(() => events.push('received'));
  const primary = installLocationLinkProtocol({
    app,
    inbox,
    argv: [href],
    register,
    focus: () => events.push('focus'),
    invalid: () => inbox.invalid(),
  });
  return { app, inbox, events, primary };
}
test('protocol receives cold and warm intents and registers only when enabled', () => {
  const f = setup(true, true);
  assert.equal(f.primary, true);
  assert.deepEqual(f.events, ['received', 'gamejam']);
  assert.equal(f.inbox.pending().href, href);
  f.app.emit('second-instance', {}, [
    'ignored.exe',
    href.replace('id=a', 'id=b'),
  ]);
  assert.equal(f.inbox.pending().href, href.replace('id=a', 'id=b'));
  let prevented = false;
  f.app.emit(
    'open-url',
    {
      preventDefault() {
        prevented = true;
      },
    },
    href,
  );
  assert.equal(prevented, true);
  assert.equal(f.events.at(-1), 'focus');
  assert.ok(
    !setup().events.includes('gamejam'),
    'isolated profiles do not overwrite the OS mapping',
  );
});
test('secondary process quits before registration and malformed OS URLs have a visible generic failure', () => {
  const f = setup(false, true);
  assert.equal(f.primary, false);
  assert.deepEqual(f.events, ['quit']);
  assert.equal(f.inbox.pending(), null);
  const g = setup();
  g.app.emit('second-instance', {}, ['gamejam://open?token=secret']);
  assert.equal(g.inbox.pending().href, '');
  assert.ok(!JSON.stringify(g.inbox.pending()).includes('secret'));
});
