import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { useLocationLinks } from '../src/ui/locations/useLocationLinks.ts';

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
test('late flush/copy requests cannot cross a project session and a failed direct open drains a newly received link', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const saved = new Map();
  for (const key of [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'IS_REACT_ACT_ENVIRONMENT',
  ]) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key],
    });
  }
  let view,
    workspace = {
      root: 'A',
      session: { projectKey: 'A', sessionId: 'A', epoch: 1 },
    },
    gate = deferred(),
    openCount = 0,
    pending = null,
    received = () => {},
    flush = () => gate.promise;
  const api = {
    desktop: {
      locationLinks: {
        open: async () => {
          openCount++;
          throw Error('bad link');
        },
        create: async () => {
          throw Error('must not create');
        },
        pending: async () => pending,
        acknowledge: async () => {
          pending = null;
        },
        onReceived: (fn) => {
          received = fn;
          return () => {};
        },
      },
      copyText: async () => {
        throw Error('must not copy');
      },
    },
    projects: { getWorkspace: async () => workspace },
  };
  function Harness() {
    view = useLocationLinks(() => ({
      api,
      workspace,
      ready: true,
      flush,
      enter: async () => {},
      navigate: () => {},
      composing: () => false,
      report: () => {},
    }));
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(Harness)));
    let copying;
    await act(async () => {
      copying = view.copy({ kind: 'document', id: 'a' });
    });
    workspace = {
      root: 'B',
      session: { projectKey: 'B', sessionId: 'B', epoch: 2 },
    };
    await act(async () => {
      root.render(React.createElement(Harness));
      gate.resolve();
      await copying;
    });
    assert.equal(openCount, 0);
    assert.equal(view.error, '');
    gate = deferred();
    flush = () => gate.promise;
    let opening;
    await act(async () => {
      opening = view.openHref('bad');
      pending = { id: 1, href: 'next' };
      received();
    });
    await act(async () => {
      gate.resolve();
      await opening;
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    assert.equal(
      openCount,
      2,
      'received link is processed after the direct request finishes',
    );
    assert.equal(pending, null);
    assert.equal(view.error, 'bad link');
    await act(async () => view.dismissError());
    assert.equal(view.error, '');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of saved)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
  }
});
