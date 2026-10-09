import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GAME_FEATURE_CATALOG,
  GAME_FEATURES,
  GAME_FEATURE_PRESETS,
  searchGameFeatures,
} from '../src/game-feature-catalog.ts';
import { gamejamFieldPage } from '../src/gamejam-wizard.ts';

test('catalog has unique feature identities and all preset references resolve', () => {
  assert.equal(GAME_FEATURE_CATALOG.length, 32);
  assert.ok(GAME_FEATURES.length > 500);
  assert.equal(
    new Set(GAME_FEATURES.map((feature) => feature.id)).size,
    GAME_FEATURES.length,
  );
  const names = new Set(GAME_FEATURES.map((feature) => feature.name));
  for (const preset of GAME_FEATURE_PRESETS) {
    for (const name of preset.features)
      assert.ok(names.has(name), `${preset.name}: ${name}`);
  }
});

test('search finds aliases across folders and combines words without hiding their paths', () => {
  for (const [query, expected] of [
    ['추격', '플레이어 추적'],
    [' FPS ', '재장전'],
    ['ｆｐｓ', '탄창'],
    ['타격감', '피격 흔들림'],
    ['AI 추적', '플레이어 추적'],
  ]) {
    const results = searchGameFeatures(query);
    assert.ok(
      results.some((feature) => feature.name === expected),
      query,
    );
    assert.ok(results.every((feature) => feature.category && feature.group));
  }
  assert.equal(searchGameFeatures('').length, GAME_FEATURES.length);
  assert.deepEqual(searchGameFeatures('존재하지않는기능'), []);
});

test('validation fields route to the page that can repair them', () => {
  assert.equal(gamejamFieldPage('steps'), 1);
  assert.equal(gamejamFieldPage('name'), 2);
  assert.equal(gamejamFieldPage('html-result'), 2);
  assert.equal(gamejamFieldPage('organize'), 3);
  assert.equal(gamejamFieldPage('implement'), 3);
  assert.equal(gamejamFieldPage('connection'), 5);
  assert.equal(gamejamFieldPage('model'), 5);
  assert.equal(gamejamFieldPage('status'), 5);
});
