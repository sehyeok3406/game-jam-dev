import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { PlayError } from './errors.ts';
import { htmlReferences } from '../html-references.ts';
import {
  DEFAULT_MULTIPLAYER,
  type MultiplayerSettings,
  type MultiplayerManifest,
} from './types.ts';

export function multiplayerSettings(
  value: unknown,
): MultiplayerSettings | null | undefined {
  if (value === undefined || value === null) return value;
  const input = value as MultiplayerSettings;
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    input.version !== 1 ||
    input.authority !== 'host' ||
    input.minPlayers !== 2 ||
    ![2, 3, 4].includes(input.maxPlayers) ||
    input.sdkVersion !== 1 ||
    input.solo !== true
  )
    throw Error(
      '[GC-MP-001] 멀티플레이 설정을 확인해주세요. 2~4인 협동·혼자 플레이를 지원합니다.',
    );
  return { ...DEFAULT_MULTIPLAYER, maxPlayers: input.maxPlayers };
}

export function readMultiplayerManifest(
  html: string,
): MultiplayerManifest | undefined {
  let found: MultiplayerManifest | undefined;
  function visit(node: DefaultTreeAdapterMap['node']) {
    if (
      'tagName' in node &&
      node.tagName === 'script' &&
      node.attrs.some(
        (a) => a.name === 'id' && a.value === 'gamejam-multiplayer',
      )
    ) {
      if (
        found ||
        node.attrs.find((a) => a.name === 'type')?.value !== 'application/json'
      )
        throw Error('[GC-MP-001] 멀티플레이 선언은 JSON 한 개여야 합니다.');
      const text = node.childNodes
        .map((n) => ('value' in n ? n.value : ''))
        .join('');
      if (text.length > 2048)
        throw Error('[GC-MP-001] 멀티플레이 선언이 너무 큽니다.');
      const value = JSON.parse(text);
      const settings = multiplayerSettings(value);
      if (!settings || value.stateVersion !== 1)
        throw Error('[GC-MP-001] 지원하지 않는 게임 상태 버전입니다.');
      found = { ...settings, stateVersion: 1 };
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child);
  }
  visit(parse(html));
  return found;
}

export function validateMultiplayerHtml(
  html: string,
  expected?: MultiplayerSettings | null,
) {
  const manifest = readMultiplayerManifest(html);
  if (expected === null && manifest)
    throw Error(
      '[GC-MP-001] 멀티 모듈 제거 요청이 결과에 반영되지 않았습니다.',
    );
  if (expected && (!manifest || manifest.maxPlayers !== expected.maxPlayers))
    throw Error(
      '[GC-MP-001] 요청한 멀티플레이 모듈·인원을 결과에 반영해주세요.',
    );
  if (manifest && htmlReferences(html, 'html').length)
    throw Error(
      '[GC-MP-001] 멀티 게임의 CSS·JS·에셋은 단일 HTML 안에 포함해주세요.',
    );
  return manifest;
}

/** No prototypes, unbounded nesting, non-finite values, or giant allocations. */
export function jsonPayload(value: unknown, maxBytes: number): string {
  let count = 0;
  const walk = (item: unknown, depth: number) => {
    if (++count > 8192 || depth > 16)
      throw Error('[GC-MP-002] 게임 데이터 구조가 너무 큽니다.');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item === 'string') {
      if (item.length > maxBytes)
        throw new PlayError('GC-MP-019', { limit: maxBytes });
      return;
    }
    if (Array.isArray(item)) {
      for (const child of item) walk(child, depth + 1);
      return;
    }
    if (
      item &&
      typeof item === 'object' &&
      [Object.prototype, null].includes(Object.getPrototypeOf(item))
    ) {
      for (const [key, child] of Object.entries(item)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key))
          throw Error('[GC-MP-002] 허용되지 않는 게임 데이터입니다.');
        walk(child, depth + 1);
      }
      return;
    }
    throw Error('[GC-MP-002] 게임 상태는 유한한 JSON 값이어야 합니다.');
  };
  walk(value, 0);
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).byteLength > maxBytes)
    throw Error('[GC-MP-002] 게임 데이터 전송 크기를 초과했습니다.');
  return encoded;
}

export function validateSnapshot(value: unknown) {
  jsonPayload(value, 32 * 1024);
  const data = value as {
    state?: unknown;
    tick: number;
    rng: number;
    emission: number;
    sequences: unknown[];
  };
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    data.state === undefined ||
    !Number.isSafeInteger(data.tick) ||
    data.tick < 0 ||
    !Number.isInteger(data.rng) ||
    data.rng < 0 ||
    data.rng > 0xffffffff ||
    !Number.isSafeInteger(data.emission) ||
    data.emission < 0 ||
    !Array.isArray(data.sequences) ||
    data.sequences.length > 64 ||
    data.sequences.some(
      (item) =>
        !Array.isArray(item) ||
        item.length !== 2 ||
        typeof item[0] !== 'string' ||
        !Number.isSafeInteger(item[1]),
    )
  )
    throw Error('[GC-MP-002] 게임 스냅샷 메타데이터를 확인해주세요.');
}
