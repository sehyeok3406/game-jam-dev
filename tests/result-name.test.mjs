import assert from 'node:assert/strict';
import { test } from 'node:test';
import matter from 'gray-matter';
import { resultName, resultFileStem } from '../src/result-name.ts';
import {
  documentOutputs,
  documentSets,
  resolveDocumentOutputs,
} from '../src/document-output.ts';
import {
  nextPreviewPath,
  isPreviewPath,
  previewLabel,
  previewWindowPath,
} from '../src/preview-output.ts';
import { expectedArtifacts } from '../src/ai-artifacts.ts';
import { createTaskSpecification } from '../src/task-specification.ts';
import {
  reduceCollaboration,
  checkSnapshot,
} from '../src/collaboration-model.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';

test('result names preserve Unicode but reject unsafe filenames and paths', () => {
  assert.equal(resultName(), '');
  assert.equal(resultName('  한밤의 카페  '), '한밤의 카페');
  assert.equal(resultFileStem('한밤의  카페'), '한밤의-카페');
  for (const value of [
    null,
    4,
    '../game',
    'a/b',
    'a\\b',
    'a.html',
    'C:game',
    'a\nnew',
    'CON',
    'a'.repeat(81),
  ])
    assert.throws(() => resultName(value), { code: 'GC-AI-001' });
});
test('named document sets are reserved, recognized and updated without renaming existing files', () => {
  const first = resolveDocumentOutputs([], { mode: 'new' }, '플레이어 시스템');
  assert.deepEqual(first, documentOutputs('docs', '플레이어 시스템'));
  assert.equal(first[0], 'docs/플레이어-시스템-game-overview.md');
  const second = resolveDocumentOutputs(first, { mode: 'new' }, '몬스터');
  assert.equal(second[0], 'docs/versions/v2/몬스터-game-overview.md');
  // Reversed input order must not confuse docs with its nested versions.
  const sets = documentSets([...second, ...first]);
  assert.deepEqual(
    sets.map((set) => set.paths),
    [first, second],
  );
  assert.deepEqual(
    resolveDocumentOutputs(
      [...first, ...second],
      { mode: 'update', baseDir: 'docs' },
      '새 제목',
    ),
    first,
  );
  assert.deepEqual(
    resolveDocumentOutputs(
      [...first, ...second],
      { mode: 'update', baseDir: 'docs/versions/v2' },
      '새 제목',
    ),
    second,
  );
  assert.deepEqual(
    expectedArtifacts(matter.stringify('task', { expected_outputs: second })),
    second,
  );
});
test('named HTML versions have independent window state and preserve legacy paths', () => {
  const first = nextPreviewPath([], '한밤의 카페');
  assert.equal(first, 'output/games/v1-한밤의-카페/index.html');
  assert.equal(isPreviewPath(first), true);
  assert.equal(
    nextPreviewPath([first], '다른 게임'),
    'output/games/v2-다른-게임/index.html',
  );
  assert.equal(previewLabel(first), '한밤의-카페 · 버전 1');
  assert.equal(
    previewWindowPath(first),
    '.canvas/previews/game-v1-한밤의-카페.json',
  );
  assert.notEqual(
    previewWindowPath(first),
    previewWindowPath('output/versions/v2.html'),
  );
  assert.deepEqual(
    expectedArtifacts(matter.stringify('task', { expected_outputs: [first] })),
    [first],
  );
  for (const bad of [
    'output/versions/v2-../evil.html',
    'output/versions/v02-game.html',
    'output/versions/v9007199254740992.html',
  ])
    assert.equal(isPreviewPath(bad), false);
});
test('shared named tasks carry identical AI naming instructions and reserve output paths', () => {
  const files = {
    'project.md': matter.stringify('Game', {
      id: 'project',
      title: 'Game',
      type: 'overview',
      status: 'draft',
      sources: [],
    }),
  };
  for (const kind of ['organize', 'implement']) {
    const input = {
      kind,
      inputPaths: ['project.md'],
      x: 0,
      y: 0,
      resultName: '한밤의 카페',
      htmlResult: { mode: 'new' },
      documentResult: { mode: 'new' },
    };
    const reduced = reduceCollaboration(files, 'tasks:create', input);
    const parsed = matter(reduced.files[reduced.result.relativePath]);
    checkSnapshot(reduced.files);
    assert.equal(parsed.data.result_name, '한밤의 카페');
    assert.match(parsed.data.expected_outputs[0], /한밤의-카페/);
    const local = matter(
      createTaskSpecification(
        input,
        parsed.data.id,
        parsed.data.expected_outputs,
      ),
    );
    assert.equal(parsed.content.trim(), local.content.trim());
    const again = reduceCollaboration(reduced.files, 'tasks:create', input);
    const next = matter(again.files[again.result.relativePath]);
    assert.notDeepEqual(
      parsed.data.expected_outputs,
      next.data.expected_outputs,
    );
    assert.equal(reduced.files['project.md'], files['project.md']);
  }
});
test('old servers cannot silently drop the requested result name', async () => {
  const client = new CollaborationClient(
    {
      serverUrl: 'http://127.0.0.1:4318',
      projectId: '00000000-0000-0000-0000-000000000000',
      token: 'fixture',
    },
    () => {},
  );
  client.state.connected = true;
  client.state.taskInstructionsEditable = true;
  let sent = false;
  client.request = async () => {
    sent = true;
    throw new Error('Must not send');
  };
  await assert.rejects(
    client.command('tasks:create', { resultName: '한밤의 카페' }),
    /서버.*업데이트/,
  );
  assert.equal(sent, false);
  client.stop();
});
