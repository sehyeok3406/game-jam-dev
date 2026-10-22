import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import ts from 'typescript';
import { APP_API_GROUPS } from '../src/contracts/app-api.ts';
import { groupBridge } from '../src/ui/runtime/bridge-runtime.ts';
import { createMemoryPreferences } from '../src/ui/runtime/preferences.ts';
import { requireDesktopApi } from '../src/ui/runtime/desktop-api.ts';
import { applyExternalCommand } from '../src/application/editing/command-service.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { serverCapabilities } from '../src/server/capabilities.ts';

test('contracts import only contracts, including inline import types', async () => {
  const root = path.resolve('src/contracts');
  for (const entry of await fs.readdir(root)) {
    const filename = path.join(root, entry);
    const sf = ts.createSourceFile(
      filename,
      await fs.readFile(filename, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node) {
      let specifier;
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier
      )
        specifier = node.moduleSpecifier.text;
      if (ts.isImportTypeNode(node)) specifier = node.argument.literal.text;
      if (specifier) {
        assert.ok(specifier.startsWith('.'), `${entry}: ${specifier}`);
        const target = path.resolve(path.dirname(filename), specifier);
        assert.ok(target.startsWith(root + path.sep), `${entry}: ${specifier}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
  }
});

test('grouped bridge forwards arguments, binding, rejection and unsubscribe without touching the global', async () => {
  let listener;
  let stopped = 0;
  const events = [];
  const bridge = {
    prefix: 'bridge',
    async listProjects(refresh) {
      events.push(refresh);
      return [this.prefix];
    },
    async saveDocument(input) {
      if (input.title === 'fail') throw Error('disk');
      return input;
    },
    onDocumentSaveChanged(value) {
      listener = value;
      return () => {
        stopped++;
      };
    },
  };
  const api = groupBridge(bridge);
  assert.equal(Object.keys(APP_API_GROUPS).length, 131);
  assert.deepEqual(await api.projects.listProjects(true), ['bridge']);
  assert.deepEqual(events, [true]);
  const input = { relativePath: 'docs/test.md', title: '저장', body: '한글' };
  assert.equal(await api.editor.saveDocument(input), input);
  await assert.rejects(
    api.editor.saveDocument({ ...input, title: 'fail' }),
    /disk/,
  );
  assert.equal(api.editor.saveDocument, api.editor.saveDocument);
  const seen = [];
  const stop = api.saves.onDocumentSaveChanged((value) => seen.push(value));
  listener({ sequence: 7, phase: 'saved' });
  stop();
  assert.equal(stopped, 1);
  assert.deepEqual(seen, [{ sequence: 7, phase: 'saved' }]);
  assert.equal(api.desktop.selfHost, undefined);
  assert.equal(api.preview.multiplayer, undefined);
  bridge.listProjects = async () => ['replacement'];
  assert.deepEqual(await api.projects.listProjects(), ['replacement']);
});

test('preview preference stores isolate project keys and preserve Storage enumeration semantics', () => {
  const one = createMemoryPreferences(),
    two = createMemoryPreferences();
  one.setItem('game-canvas-theme', 'dark');
  one.setItem('game-canvas-active-sheet:existing-project', 'sheet-1');
  assert.equal(two.getItem('game-canvas-theme'), null);
  assert.equal(one.length, 2);
  assert.equal(one.key(1), 'game-canvas-active-sheet:existing-project');
  one.removeItem(one.key(1));
  assert.equal(one.length, 1);
});

test('desktop absence is explicit and UI feature code has no global bridge or preference access', async () => {
  assert.throws(() => requireDesktopApi({}), {
    code: 'GC-RUNTIME-UNSUPPORTED',
  });
  async function check(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await check(filename);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || entry.name === 'uiDebugPreview.tsx')
        continue;
      const source = await fs.readFile(filename, 'utf8');
      assert.doesNotMatch(
        source,
        /window\.gameCanvas|\blocalStorage\b/,
        filename,
      );
    }
  }
  await check('src/ui');
  await check('src/features');
});

test('external command validation keeps save reducer output distinct from IPC and rejects a mixed invalid batch atomically', () => {
  const files = {
    'docs/test.md':
      '---\nid: doc-test\ntitle: 기존\ntype: idea\n---\n이전 본문\n',
  };
  const saved = applyExternalCommand(files, 'documents:save', {
    relativePath: 'docs/test.md',
    title: '수정',
    body: '한글 저장',
  });
  assert.equal(saved.result, undefined);
  assert.match(saved.files['docs/test.md'], /한글 저장/);
  assert.match(files['docs/test.md'], /이전 본문/);
  for (const channel of ['constructor', '__proto__', 'unknown', null])
    assert.throws(() => applyExternalCommand(files, channel, {}), /허용되지/);
  assert.throws(() =>
    applyExternalCommand(files, 'documents:save', {
      relativePath: '../escape.md',
      title: 'x',
      body: 'x',
    }),
  );
  assert.throws(
    () =>
      applyExternalCommand(files, 'canvas:batch', {
        commands: [
          {
            channel: 'documents:delete-many',
            input: {
              documents: [
                { documentId: 'doc-test', relativePath: 'docs/test.md' },
              ],
            },
          },
          { channel: 'documents:save', input: {} },
        ],
      }),
    /허용되지/,
  );
  assert.ok(files['docs/test.md']);
});

test('wire v1 health and authenticated state keep feature values and persist an old-style save over restart', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-contracts-'),
  );
  let server = await createCollaborationServer({
    dataDirectory: directory,
    port: 0,
  });
  let client;
  t.after(async () => {
    client?.stop();
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.port}`;
  const health = await (await fetch(url + '/health')).json();
  assert.equal(health.protocol, 1);
  const created = await CollaborationClient.create(
    url,
    '',
    '관리자',
    'legacy',
    {
      'docs/test.md':
        '---\nid: doc-test\ntitle: 기존\ntype: idea\n---\n이전 본문\n',
    },
  );
  client = new CollaborationClient(created.credentials, () => {});
  client.accept(created.result);
  for (const [key, value] of Object.entries(serverCapabilities())) {
    assert.equal(health[key], value, key);
    assert.equal(client.state[key], value, key);
  }
  await client.lock('docs/test.md');
  await client.command('documents:save', {
    relativePath: 'docs/test.md',
    title: '수정',
    body: '프로토콜 유지',
  });
  await client.unlock('docs/test.md');
  const revision = client.state.revision;
  client.stop();
  await server.close();
  server = await createCollaborationServer({
    dataDirectory: directory,
    port: 0,
  });
  client.credentials.serverUrl = `http://127.0.0.1:${server.port}`;
  await client.refresh();
  assert.equal(client.state.revision, revision);
  assert.match(client.files['docs/test.md'], /프로토콜 유지/);
});
