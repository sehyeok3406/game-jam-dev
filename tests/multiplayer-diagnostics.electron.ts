import { app, BrowserWindow, clipboard } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { PlayClient } from '../src/multiplayer/client.ts';
import { registerMultiplayerWindows } from '../src/multiplayer/window-manager.ts';
import { COOP_REFERENCE_HTML } from '../src/multiplayer/reference-game.ts';
import { validateHtml } from '../src/html-validation.ts';

const output = path.resolve('out/multiplayer-diagnostics-qa');
app.setPath('userData', path.join(output, 'profile'));
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const temp = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-diagnostic-native-'),
  );
  let server, manager, guest, win;
  let failed = false;
  const savedClipboard = await clipboard.readText();
  const until = async (check: () => Promise<unknown>, label: string) => {
    for (let n = 0; n < 200; n++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw Error(label);
  };
  try {
    await fs.mkdir(output, { recursive: true });
    // Registration failures must retain their multiplayer code in AI validation.
    await assert.rejects(
      validateHtml(
        COOP_REFERENCE_HTML.replace(
          'createState({players}){',
          'createState({players}){throw new Error("PRIVATE-CONTENT");',
        ),
        'broken.html',
      ),
      (error) => error.code === 'GC-MP-013',
    );
    server = await createCollaborationServer({ port: 0, dataDirectory: temp });
    const url = `http://127.0.0.1:${server.port}`,
      gamePath = 'output/prototypes/test/v001/index.html';
    const owner = await CollaborationClient.create(
      url,
      '',
      'host',
      'Diagnostic QA',
      {
        'project.md':
          '---\nid: project\ntitle: Diagnostic QA\ntype: idea\nstatus: draft\nsources: []\n---\nQA',
        [gamePath]: COOP_REFERENCE_HTML,
      },
    );
    const joined = await CollaborationClient.join(
      url,
      owner.result.code,
      'guest',
    );
    const control = (
      auth: typeof owner.credentials,
      action: Record<string, unknown>,
    ) =>
      PlayClient.control(auth, { ...action, requestId: randomUUID() } as never);
    const room = (
      await control(owner.credentials, {
        action: 'create',
        path: gamePath,
        sourceHash: createHash('sha256')
          .update(COOP_REFERENCE_HTML)
          .digest('hex'),
      })
    ).room!;
    await control(joined.credentials, { action: 'join', roomId: room.id });
    let begun = false;
    guest = new PlayClient(joined.credentials, room, (message) => {
      if (message.type === 'connection' && message.connected)
        guest.send({ type: 'loaded' });
      if (
        message.type === 'room' &&
        guest.room.status === 'loading' &&
        !begun
      ) {
        begun = true;
        guest.send({ type: 'begun' });
      }
    });
    guest.connect();
    manager = registerMultiplayerWindows({
      preload: path.join(output, 'multiplayer-player-preload.cjs'),
      credentials: () => owner.credentials,
      memberId: () => owner.result.state.memberId,
      isMainSender: () => false,
      currentHtml: () => COOP_REFERENCE_HTML,
    });
    await manager.open(room.id);
    win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())!;
    const js = (code: string) => win.webContents.executeJavaScript(code, true);
    await until(
      () => js('!document.querySelector("#ready").disabled'),
      'player loaded',
    );
    await until(
      async () => guest.room.members.every((m) => m.loaded),
      'guest loaded',
    );
    await js('document.querySelector("#ready").click()');
    await control(joined.credentials, {
      action: 'ready',
      roomId: room.id,
      ready: true,
    });
    await until(
      () => js('!document.querySelector("#start").disabled'),
      'ready barrier',
    );
    await js('document.querySelector("#start").click()');
    await until(
      () =>
        js(
          'document.querySelector("#status").textContent.includes("함께 플레이 중")',
        ),
      'running',
    );
    const frame = win.webContents.mainFrame.frames.find(
      (f) => f.url === 'about:srcdoc',
    )!;
    await frame.executeJavaScript(
      'GameJamMultiplayer.reportIssue({area:"rules",code:"GAME-PUSH-001",message:"PRIVATE-CONTENT"})',
    );
    await until(
      () => js('!document.querySelector("#failure").hidden'),
      'diagnostic visible',
    );
    await until(
      async () =>
        guest.room.status === 'finished' &&
        guest.room.failure?.code === 'GC-MP-016',
      'server incident propagated',
    );
    assert.match(
      await js('document.querySelector("#failure-message").textContent'),
      /게임 규칙/,
    );
    assert.match(
      await js('document.querySelector("#failure-code").textContent'),
      /GC-MP-016/,
    );
    await js('document.querySelector("#copy-diagnostics").click()');
    await until(
      () =>
        js(
          'document.querySelector("#copy-result").textContent.includes("복사했어요")',
        ),
      'copy report',
    );
    const copied = await clipboard.readText();
    assert(!copied.includes('PRIVATE-CONTENT'));
    assert(!copied.includes(owner.credentials.token));
    const report = JSON.parse(copied);
    const incident = report.entries.find((e) => e.failure.code === 'GC-MP-016');
    assert.equal(incident.failure.id, guest.room.failure.id);
    assert.equal(incident.failure.details.customCode, 'GAME-PUSH-001');
    assert.equal(incident.failure.details.sourceHash, room.sourceHash);
    assert.equal(
      await frame.executeJavaScript('typeof window.gameJamPlayer'),
      'undefined',
    );
    await fs.writeFile(
      path.join(output, 'error-screen.png'),
      (await win.webContents.capturePage()).toPNG(),
    );
    await fs.writeFile(
      path.join(output, 'report.json'),
      JSON.stringify(
        {
          passed: true,
          validationCode: true,
          gameErrorCode: 'GC-MP-016',
          customCode: 'GAME-PUSH-001',
          incidentMatches: true,
          safeClipboard: true,
          minimalPreload: true,
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS: real player failure, common validation code, server/client incident correlation, diagnostics display/copy, private data excluded.',
    );
  } catch (error) {
    failed = true;
    console.error(error);
  } finally {
    await clipboard.writeText(savedClipboard);
    manager?.close();
    guest?.close();
    win?.destroy();
    await server?.close();
    await fs.rm(temp, { recursive: true, force: true });
    app.exit(failed ? 1 : 0);
  }
});
