import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_PROJECT_NAME, projectDirectoryName } from '../src/project-name.ts';

test('project names accept PROJECTRC, Korean, digits and safe punctuation', () => {
  for (const name of [
    'PROJECTRC',
    '프로젝트 RC',
    'My Game 2',
    'my-game_v1.0',
    'CONSOLE',
    'a'.repeat(MAX_PROJECT_NAME),
  ])
    assert.equal(projectDirectoryName(name), name);
});

test('surrounding spaces are removed before length, suffix and reserved-name checks', () => {
  assert.equal(projectDirectoryName(' PROJECTRC '), 'PROJECTRC');
  assert.equal(
    projectDirectoryName(` ${'a'.repeat(MAX_PROJECT_NAME)} `),
    'a'.repeat(MAX_PROJECT_NAME),
  );
  assert.throws(() => projectDirectoryName(' CON '), /예약 이름/);
  assert.throws(() => projectDirectoryName(' NUL.txt '), /예약 이름/);
  assert.throws(() => projectDirectoryName('trailing. '), /점/);
});

test('invalid names explain the actual restriction', () => {
  for (const name of ['', '   ', 'a'.repeat(MAX_PROJECT_NAME + 1)])
    assert.throws(() => projectDirectoryName(name), /1~100자/);
  for (const name of ['CON', 'prn', 'AUX', 'NUL.txt', 'COM1', 'LPT9.log'])
    assert.throws(() => projectDirectoryName(name), /예약 이름/);
  for (const char of '<>:"/\\|?*')
    assert.throws(
      () => projectDirectoryName(`bad${char}name`),
      /문자를 사용할 수 없습니다/,
    );
  for (const name of ['line\nbreak', '\tPROJECTRC', 'PROJECTRC\u0000'])
    assert.throws(() => projectDirectoryName(name), /제어 문자/);
  assert.throws(() => projectDirectoryName(null), /텍스트/);
  assert.throws(() => projectDirectoryName('trailing.'), /점/);
});
