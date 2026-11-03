// Opt-in real-account QA. Never included in npm test and never substitutes a mock executor.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  catPng,
  forestPng,
  pixelBrief,
  neonBrief,
} from './helpers/game-build-qa-fixtures.mjs';
import { gamejamTaskInput } from '../src/gamejam-request.ts';
import { captureProject, materialize } from '../src/project-store.ts';
import { readClientCache } from '../src/client-cache.ts';
import {
  readGameBuildIndex,
  readGameBuild,
} from '../src/core/projects/game-build.ts';
import { gameBuildCodec as codec } from '../src/adapters/node/game-build-codec.ts';
import matter from '../src/markdown.ts';
if (process.env.GAMEJAM_REAL_CODEX !== '1')
  throw Error('Set GAMEJAM_REAL_CODEX=1 to authorize real Codex account QA.');
const scenario = process.argv[2] ?? 'probe';
assert.ok(
  ['probe', 'pixel', 'edit', 'neon', 'reimport', 'cancel'].includes(scenario),
);
const { root, profile, game, boot, stop, js, pause, appProcessId } =
  await import('./helpers/packaged-canvas.mjs');
const evidence = path.resolve('out/game-build-stage7', scenario);
await fs.mkdir(evidence, { recursive: true });
const call = async (method, ...args) => {
  for (let n = 0; ; n++)
    try {
      return await js(
        `window.gameCanvas[${JSON.stringify(method)}](...${JSON.stringify(args)})`,
      );
    } catch (error) {
      if (
        method !== 'createTask' ||
        n >= 50 ||
        !String(error).includes('이미 AI 작업이 진행 중입니다')
      )
        throw error;
      await pause();
    }
};
const snapshot = async () => {
  const w = await call('getWorkspace');
  assert.ok(w.root === game || w.root?.startsWith(profile + path.sep));
  return w.root === game
    ? captureProject(game)
    : (await readClientCache(path.join(w.root, 'server-cache.json'))).files;
};
async function saveHtml(relative, destination, cancel = false) {
  const pending = call('exportPreviewHtml', relative);
  const helper = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.resolve('tests/helpers/save-html-dialog.ps1'),
      '-TargetProcessId',
      String(appProcessId()),
      ...(cancel ? ['-Cancel'] : ['-Destination', destination]),
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let log = '';
  for (const s of [helper.stdout, helper.stderr])
    s.on('data', (d) => (log += d));
  const closed = new Promise((r, j) => {
    helper.once('error', j);
    helper.once('exit', (code) => (code === 0 ? r() : j(Error(log))));
  });
  return (await Promise.all([pending, closed]))[0];
}
let record = {
  scenario,
  realAccount: true,
  provider: 'codex-cli',
  status: 'running',
};
const writeRecord = () =>
  fs.writeFile(
    path.join(evidence, 'result.json'),
    JSON.stringify(record, null, 2),
  );
let baselineFiles;
try {
  if (['edit', 'reimport', 'cancel'].includes(scenario)) {
    const base = JSON.parse(
      await fs.readFile(
        path.resolve(
          'out/game-build-stage7',
          scenario === 'reimport' ? 'edit' : 'pixel',
          'snapshot.json',
        ),
        'utf8',
      ),
    );
    await materialize(game, base, true);
  } else
    await fs.writeFile(
      path.join(game, 'project.md'),
      matter.stringify(scenario === 'neon' ? neonBrief : pixelBrief, {
        id: 'qa-brief',
        title: scenario === 'neon' ? '네온 신호 정렬' : '달빛 우체부',
        type: 'idea',
        status: 'draft',
        sources: [],
      }),
    );
  await boot();
  const status = await js("window.gameCanvas.getAiStatus('codex-cli')");
  console.log(JSON.stringify(status));
  assert.equal(status.available, true, status.message);
  assert.equal(status.authenticated, true, status.message);
  record.connection = status;
  if (scenario !== 'probe') {
    await js(
      'window.qaRunEvents=[];window.gameCanvas.onCodexRunEvent(e=>{window.qaRunEvents.push(e);if(window.qaRunEvents.length>2000)window.qaRunEvents.shift();})',
    );
    let before = await snapshot(),
      previous = readGameBuildIndex(before).artifacts.at(-1),
      basePath = previous?.path;
    if (scenario === 'neon') {
      const server = await call('startLocalCollaborationServer');
      await call('createCollaboration', {
        serverUrl: server.serverUrl,
        serverKey: '',
        nickname: '실제 Codex QA 관리자',
      });
    }
    let inputs;
    if (scenario === 'pixel') {
      const w = await call('getWorkspace');
      await js(
        `(()=>{const input=${JSON.stringify({
          scope: w.saveScope,
          contextId: w.clipboardContextId,
          x: 800,
          y: 0,
          imagePurpose: 'asset',
          files: [
            { name: 'cat.png', bytes: [...catPng] },
            { name: 'forest.png', bytes: [...forestPng] },
          ],
        })};input.files.forEach(f=>f.bytes=Uint8Array.from(f.bytes));return window.gameCanvas.importFiles(input);})()`,
      );
      inputs = (await call('listDocuments')).map((d) => d.relativePath);
    } else if (scenario === 'reimport') {
      const original = before[basePath],
        w = await call('getWorkspace');
      const docs = await js(
        `(()=>{const input=${JSON.stringify({ scope: w.saveScope, contextId: w.clipboardContextId, x: 0, y: 0, imagePurpose: 'asset', files: [{ name: 'exported-postman.html', bytes: [...Buffer.from(original)] }] })};input.files.forEach(f=>f.bytes=Uint8Array.from(f.bytes));return window.gameCanvas.importFiles(input);})()`,
      );
      basePath = docs.find((d) => d.htmlSource).htmlSource;
      inputs = [basePath];
    } else
      inputs = (await call('listDocuments'))
        .filter((d) => d.type !== 'ai-task' && d.type !== 'html')
        .map((d) => d.relativePath);
    const organize =
      scenario === 'pixel' || scenario === 'neon' || scenario === 'edit';
    const updateBundle =
      scenario === 'edit'
        ? matter(
            before[
              readGameBuild(
                before,
                previous.buildId,
                codec,
              ).manifest.documents.find(
                (d) =>
                  before[d.path] &&
                  matter(before[d.path]).data.document_bundle_id,
              ).path
            ],
          ).data.document_bundle_id
        : null;
    const instructions =
      scenario === 'edit'
        ? '기존 달빛 우체부의 초기 목숨만 3에서 5로 변경하세요. 다른 규칙, 5×5 지도, 이동, 편지 3개, 1초 무적, 이미지, 배색, 화면 구성은 유지하세요. 기준 문서의 목숨도 5로 갱신하세요. 한국어 UI를 유지하세요.'
        : scenario === 'reimport'
          ? '가져온 HTML의 달빛 우체부를 참고해 새 수정용 소스와 새 게임을 만드세요. 목숨5, 편지3개, 5×5지도, Enter시작, R재시작, 방향키/WASD 한칸 이동, 원래 픽셀 숲·고양이·내장 이미지를 유지하세요. 가져온 원본 HTML은 그대로 보존하세요. 외부 파일을 추가로 받지 말고 HTML 내장 이미지 data URI를 재사용하세요. 새 게임은 1100×780 및 720×520 창 안에서 전체 5×5 판, 필수 HUD와 조작 버튼이 페이지 스크롤 없이 보이도록 배치를 맞추세요. 이미지와 판 비율, 글자·버튼 가독성을 유지하고 필요한 안내는 간결하게 배치하세요.'
          : scenario === 'neon'
            ? neonBrief
            : pixelBrief;
    baselineFiles = await snapshot();
    const task = await call(
      'createTask',
      gamejamTaskInput({
        organize,
        implement: true,
        inputPaths: inputs,
        ...(scenario === 'reimport' ? { sourceMode: 'html-compose' } : {}),
        instructions: {
          organize:
            '원본의 모든 규칙·좌표·입력·수치와 비주얼 요구를 보존해 제작 기준 문서로 정리하세요. ' +
            instructions,
          implement: instructions,
        },
        documentResult: {
          mode: updateBundle ? 'update' : 'new',
          ...(updateBundle ? { baseDir: 'bundle:' + updateBundle } : {}),
          structure: 'custom',
          documents: [
            {
              key: 'd1',
              title: '플레이 규칙',
              type: 'system',
              instructions:
                '조작·초기값·상태 전이·성공/실패·복구·원본 요구를 빠짐없이 명시',
            },
            {
              key: 'd2',
              title: '화면 구성',
              type: 'system',
              instructions:
                '아트 방향·제공 이미지 역할·게임 영역·HUD·피드백·색과 시점',
            },
          ],
        },
        htmlResult: {
          mode: ['edit', 'cancel'].includes(scenario) ? 'update' : 'new',
          ...(['edit', 'reimport', 'cancel'].includes(scenario)
            ? { basePath }
            : {}),
        },
        resultName:
          scenario === 'neon'
            ? '네온 신호 정렬'
            : scenario === 'reimport'
              ? '달빛 우체부 재가져오기'
              : '달빛 우체부',
        x: 0,
        y: 0,
      }),
    );
    const started = await call('startCodexRun', {
      taskPath: task.relativePath,
      providerId: 'codex-cli',
      modelId: 'gpt-6.1-sol',
      reasoningEffort: process.env.GAMEJAM_QA_REASONING ?? 'low',
    });
    record.task = task.relativePath;
    record.runId = started.runId;
    await writeRecord();
    console.log('START', scenario, started.runId);
    let completed,
      last = '',
      cancellationRequested = false;
    for (let n = 0; n < 1200; n++) {
      const active = await call('getActiveRun');
      if (active?.message && active.message !== last) {
        last = active.message;
        console.log('PROGRESS', scenario, last.slice(0, 240));
      }
      if (scenario === 'cancel' && n >= 8 && !cancellationRequested) {
        cancellationRequested = true;
        await call('cancelCodexRun', started.runId);
      }
      completed = (await call('listHistory')).find(
        (h) =>
          (h.id === started.runId || h.taskPath === task.relativePath) &&
          ['completed', 'failed', 'cancelled'].includes(h.status),
      );
      if (completed) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    await fs.writeFile(
      path.join(evidence, 'events.json'),
      JSON.stringify(await js('window.qaRunEvents'), null, 2),
    );
    record.history = completed;
    if (!completed) {
      await call('cancelCodexRun', started.runId).catch(() => {});
      throw Error('Real Codex scenario exceeded 20 minutes.');
    }
    if (scenario === 'cancel') {
      assert.equal(completed.status, 'cancelled');
      const current = await snapshot();
      const business = (files) =>
        Object.fromEntries(
          Object.entries(files).filter(([p]) =>
            /^(?:project\.md$|docs\/|ideas\/|assets\/|output\/|\.game-builds\/)/.test(
              p,
            ),
          ),
        );
      assert.deepEqual(business(current), business(baselineFiles));
      record.status = 'passed';
      record.originalsPreserved = true;
      await writeRecord();
      console.log(
        'PASS real Codex cancellation preserves all original documents, source and HTML',
      );
    } else {
      assert.equal(
        completed.status,
        'completed',
        completed.error ?? completed.summary ?? JSON.stringify(completed),
      );
      const output = completed.files.find(
        (f) =>
          f.relativePath.startsWith('output/') &&
          f.relativePath.endsWith('.html'),
      ).relativePath;
      let files, saved, artifact;
      for (let n = 0; n < 150; n++) {
        files = await snapshot();
        artifact = readGameBuildIndex(files).artifacts.find(
          (a) => a.path === output,
        );
        if (artifact)
          try {
            saved = readGameBuild(files, artifact.buildId, codec);
            break;
          } catch {}
        await pause();
      }
      assert.ok(saved, 'committed source reaches durable local/shared cache');
      await fs.writeFile(
        path.join(evidence, 'snapshot.json'),
        JSON.stringify(files, null, 2),
      );
      await fs.writeFile(path.join(evidence, 'game.html'), files[output]);
      await fs.writeFile(
        path.join(evidence, 'manifest.json'),
        JSON.stringify(saved.manifest, null, 2),
      );
      for (const [p, raw] of Object.entries(saved.sources)) {
        const target = path.join(evidence, 'source', p);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, raw);
      }
      record.output = output;
      record.manifest = saved.manifest;
      record.lock = saved.lock;
      if (scenario === 'pixel') assert.equal(saved.manifest.assets.length, 2);
      if (scenario === 'neon')
        assert.ok(
          saved.lock.packages.some(
            (p) => p.name === 'three' && p.version === '0.187.0',
          ),
        );
      if (scenario === 'edit') {
        assert.equal(output, previous.path);
        assert.equal(artifact.artifactId, previous.artifactId);
        assert.notEqual(artifact.buildId, previous.buildId);
        assert.deepEqual(
          saved.lock,
          readGameBuild(before, previous.buildId, codec).lock,
        );
        await call('restoreHistory', completed.id, undefined, 'before');
        assert.equal((await snapshot())[output], before[output]);
        await call('restoreHistory', completed.id, undefined, 'after');
        assert.equal((await snapshot())[output], files[output]);
        record.restore = 'before/after exact HTML and source revision passed';
      }
      if (scenario === 'reimport') {
        assert.equal(files[basePath], before[previous.path]);
        record.originalImportPreserved = true;
      }
      const exported = path.join(evidence, 'export.html');
      await fs.rm(exported, { force: true });
      assert.equal(await saveHtml(output, exported, true), false);
      await assert.rejects(fs.access(exported));
      assert.equal(await saveHtml(output, exported), true);
      assert.deepEqual(await fs.readFile(exported), Buffer.from(files[output]));
      record.nativeExport = 'exact bytes and cancel passed';
      record.status = 'passed';
      await writeRecord();
      console.log(
        'PASS',
        scenario,
        output,
        saved.manifest.output.bytes,
        'bytes',
      );
    }
  }
} catch (error) {
  record.status = 'failed';
  record.error = String(error);
  if (baselineFiles) {
    const current = await snapshot().catch(() => null);
    if (current)
      record.originalsPreserved = Object.entries(baselineFiles)
        .filter(([p]) =>
          /^(?:project\.md$|docs\/|ideas\/|assets\/|output\/|\.game-builds\/)/.test(
            p,
          ),
        )
        .every(([p, raw]) => current[p] === raw);
  }
  await writeRecord();
  throw error;
} finally {
  await stop(true);
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.equal(
    path.dirname(profile),
    path.resolve(process.env.APPDATA, 'Game Canvas', 'test-users'),
  );
  await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
