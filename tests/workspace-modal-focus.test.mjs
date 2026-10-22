import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import {
  installWorkspaceModalFocus,
  topWorkspaceModal,
} from '../src/ui/shell/modal-focus.ts';

function setup(t) {
  const dom = new JSDOM(
    '<button id="opener">open</button><button id="outside">outside</button>',
    { pretendToBeVisual: true },
  );
  const { document, HTMLElement } = dom.window;
  // jsdom does not lay out: supply geometry only, keeping its real focus/event/observer behavior.
  HTMLElement.prototype.getClientRects = function () {
    return this.isConnected &&
      !this.closest('[hidden],[style*="display: none"]')
      ? [{}]
      : [];
  };
  document.getElementById('opener').focus();
  const stop = installWorkspaceModalFocus(document);
  t.after(() => {
    stop();
    dom.window.close();
  });
  const tick = () =>
    new Promise((resolve) => dom.window.queueMicrotask(resolve));
  async function add(
    id,
    z = 80,
    html = '<button class="first">first</button><input><button class="last">last</button>',
  ) {
    const backdrop = document.createElement('div');
    backdrop.style.position = 'fixed';
    backdrop.style.zIndex = String(z);
    backdrop.innerHTML = `<section id="${id}" role="dialog" aria-modal="true">${html}</section>`;
    document.body.append(backdrop);
    await tick();
    return backdrop.firstElementChild;
  }
  const key = (shiftKey = false) =>
    document.activeElement.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey,
        bubbles: true,
        cancelable: true,
      }),
    );
  return { dom, document, stop, tick, add, key };
}
test('modal focus wraps once, excludes disabled/hidden controls and returns to its opener', async (t) => {
  const { document, add, tick, key } = setup(t);
  const dialog = await add(
    'dialog',
    80,
    '<button class="first">first</button><button disabled>disabled</button><button hidden>hidden</button><button class="last">last</button>',
  );
  assert.equal(document.activeElement, dialog.querySelector('.first'));
  key(true);
  assert.equal(document.activeElement, dialog.querySelector('.last'));
  key();
  assert.equal(document.activeElement, dialog.querySelector('.first'));
  document.getElementById('outside').focus();
  assert.ok(dialog.contains(document.activeElement));
  dialog.parentElement.remove();
  await tick();
  assert.equal(document.activeElement.id, 'opener');
});
test('CSS stacking wins over DOM order; nested close restores the lower dialog then the original trigger', async (t) => {
  const { document, add, tick } = setup(t);
  const lower = await add('lower', 80);
  const trigger = lower.querySelector('.last');
  trigger.focus();
  const upper = await add('upper', 1200);
  const later = await add('later-but-lower', 80);
  assert.equal(topWorkspaceModal(document), upper);
  assert.ok(upper.contains(document.activeElement));
  later.parentElement.remove();
  await tick();
  assert.ok(upper.contains(document.activeElement));
  upper.parentElement.remove();
  await tick();
  assert.equal(document.activeElement, trigger);
  lower.parentElement.remove();
  await tick();
  assert.equal(document.activeElement.id, 'opener');
});
test('a dialog inserted and focused before the observer fires keeps its actual opener', async (t) => {
  const { document, tick } = setup(t);
  const backdrop = document.createElement('div');
  backdrop.innerHTML =
    '<section aria-modal="true"><input autofocus><button>close</button></section>';
  document.body.append(backdrop);
  backdrop.querySelector('input').focus();
  await tick();
  backdrop.remove();
  await tick();
  assert.equal(document.activeElement.id, 'opener');
});

test('the current active trigger is used even if a host suppresses focusin events', async (t) => {
  const { document, dom, add, tick } = setup(t);
  dom.window.addEventListener(
    'focusin',
    (event) => event.stopImmediatePropagation(),
    true,
  );
  document.getElementById('outside').focus();
  const dialog = await add('dialog');
  dialog.parentElement.remove();
  await tick();
  assert.equal(document.activeElement.id, 'outside');
});

test('a late lower-layer automatic prompt returns through a closed upper dialog to the original trigger', async (t) => {
  const { document, add, tick } = setup(t);
  const upper = await add('collaboration', 1200);
  const lower = await add('automatic-update', 80);
  assert.ok(upper.contains(document.activeElement));
  upper.parentElement.remove();
  await tick();
  assert.ok(lower.contains(document.activeElement));
  lower.parentElement.remove();
  await tick();
  assert.equal(document.activeElement.id, 'opener');
});
test('equal layers use DOM order, hidden/inert dialogs do not trap, and removed triggers are never refocused', async (t) => {
  const { document, add, tick } = setup(t);
  const first = await add('first'),
    second = await add('second');
  assert.equal(topWorkspaceModal(document), second);
  second.parentElement.hidden = true;
  await tick();
  assert.equal(topWorkspaceModal(document), first);
  assert.ok(first.contains(document.activeElement));
  first.parentElement.setAttribute('inert', '');
  await tick();
  assert.equal(topWorkspaceModal(document), undefined);
  document.getElementById('opener').remove();
  first.parentElement.remove();
  second.parentElement.remove();
  await tick();
  assert.notEqual(document.activeElement.id, 'opener');
});
test('native modal dialogs stay above CSS layers and retain native focus/Tab control', async (t) => {
  const { document, dom, add, tick } = setup(t);
  const native = document.createElement('dialog');
  native.open = true;
  native.innerHTML = '<button>native</button>';
  document.body.append(native);
  native.firstElementChild.focus();
  await add('css', 10000);
  assert.equal(topWorkspaceModal(document), native);
  assert.equal(document.activeElement, native.firstElementChild);
  const event = new dom.window.KeyboardEvent('keydown', {
    key: 'Tab',
    bubbles: true,
    cancelable: true,
  });
  native.firstElementChild.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  native.remove();
  await tick();
  assert.equal(topWorkspaceModal(document).id, 'css');
});
test('disposing a shell removes listeners and observers without closing dialogs or changing data', async (t) => {
  const { document, add, stop, tick } = setup(t);
  const dialog = await add('old');
  stop();
  document.getElementById('outside').focus();
  dialog.parentElement.remove();
  await tick();
  assert.equal(document.activeElement.id, 'outside');
  await add('new');
  assert.equal(document.activeElement.id, 'outside');
});
