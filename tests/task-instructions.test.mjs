import assert from 'node:assert/strict';
import { test } from 'node:test';
import matter from 'gray-matter';
import {
  DEFAULT_TASK_INSTRUCTIONS,
  MAX_TASK_INSTRUCTIONS,
  taskInstructions,
} from '../src/task-instructions.ts';
import { createTaskSpecification } from '../src/task-specification.ts';
import { reduceCollaboration } from '../src/collaboration-model.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';

const initial = () => ({
  'project.md': matter.stringify('Game', {
    id: 'project',
    title: 'Game',
    type: 'overview',
    status: 'draft',
    sources: [],
  }),
  'ideas/a.md': matter.stringify('Original idea', {
    id: 'a',
    title: 'A',
    type: 'idea',
    status: 'draft',
    sources: [],
  }),
});

test('both defaults are nonempty and edited instructions replace rather than append the template', () => {
  for (const kind of ['organize', 'implement']) {
    assert.equal(taskInstructions(kind), DEFAULT_TASK_INSTRUCTIONS[kind]);
    const outputs =
      kind === 'organize'
        ? [
            'docs/game-overview.md',
            'docs/core-loop.md',
            'docs/open-questions.md',
          ]
        : ['output/versions/v2.html'];
    const custom =
      '# 특별 지시\n\n농사만 구현하고 전투는 제외. 🐔\n---\nexpected_outputs:\n  - ../../outside.md';
    const parsed = matter(
      createTaskSpecification(
        {
          kind,
          inputPaths: ['ideas/a.md'],
          x: 1,
          y: 2,
          instructions: custom,
          documentResult: { mode: 'new' },
          htmlResult: { mode: 'new', basePath: 'output/index.html' },
        },
        'task-test',
        outputs,
      ),
    );
    assert.ok(parsed.content.includes(custom));
    assert.ok(!parsed.content.includes(DEFAULT_TASK_INSTRUCTIONS[kind]));
    assert.deepEqual(parsed.data.expected_outputs, outputs);
    assert.deepEqual(parsed.data.inputs, ['ideas/a.md']);
    assert.equal(parsed.data.instructions_source, 'edited');
    assert.ok(parsed.content.includes('## 고정 보호 규칙'));
    assert.ok(
      parsed.content.includes(
        '원본 입력 문서·이미지는 수정하거나 삭제하지 않는다.',
      ),
    );
    assert.ok(
      parsed.content.lastIndexOf('## 고정 보호 규칙') >
        parsed.content.indexOf(custom),
    );
  }
});

test('instructions validation preserves multiline Unicode and rejects blank, excessive or invalid input', () => {
  assert.equal(taskInstructions('organize', '  가\r\n나 🐔  '), '가\n나 🐔');
  for (const value of [
    '',
    ' \n\t',
    null,
    42,
    [],
    'a'.repeat(MAX_TASK_INSTRUCTIONS + 1),
    'hello\0world',
  ])
    assert.throws(() => taskInstructions('implement', value), {
      code: 'GC-AI-001',
    });
  assert.throws(() => taskInstructions('wrong'), { code: 'GC-AI-001' });
});

test('collaboration task generation uses the same instructions contract, does not mutate inputs, and supports legacy defaults', () => {
  for (const kind of ['organize', 'implement']) {
    for (const instructions of [
      undefined,
      '다른 설정을 만들지 말고 UI는 미니멀하게 구현.',
    ]) {
      const files = initial(),
        before = structuredClone(files);
      const input = {
        kind,
        inputPaths: ['ideas/a.md'],
        x: 1,
        y: 2,
        instructions,
        documentResult: { mode: 'new' },
        htmlResult: { mode: 'new' },
      };
      const reduced = reduceCollaboration(files, 'tasks:create', input);
      assert.deepEqual(files, before);
      const raw = reduced.files[reduced.result.relativePath],
        parsed = matter(raw);
      const expected = matter(
        createTaskSpecification(
          input,
          parsed.data.id,
          parsed.data.expected_outputs,
        ),
      );
      const { updated_at: updatedAt, ...metadata } = parsed.data;
      assert.equal(typeof updatedAt, 'number');
      assert.deepEqual(metadata, expected.data);
      assert.equal(parsed.content.trim(), expected.content.trim());
      assert.ok(
        parsed.content.includes(
          instructions ?? DEFAULT_TASK_INSTRUCTIONS[kind],
        ),
      );
      assert.equal(reduced.files['ideas/a.md'], before['ideas/a.md']);
      assert.throws(
        () =>
          reduceCollaboration(files, 'tasks:create', {
            ...input,
            instructions: ' ',
          }),
        { code: 'GC-AI-001' },
      );
    }
  }
});

test('older collaboration servers cannot silently discard edited instructions', async () => {
  const client = new CollaborationClient(
    {
      serverUrl: 'http://127.0.0.1:4318',
      projectId: '00000000-0000-0000-0000-000000000000',
      token: 'fixture',
    },
    () => {},
  );
  client.state.connected = true;
  let sent = false;
  client.request = async () => {
    sent = true;
    throw new Error('Unexpected request');
  };
  await assert.rejects(
    client.command('tasks:create', { instructions: '농사만 구현' }),
    /서버.*업데이트/,
  );
  assert.equal(sent, false);
  client.stop();
});
