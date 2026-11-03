import type {
  LocationItem,
  LocationLink,
  LocationTarget,
} from '../../contracts/location-links.ts';
import { validLocationAnchor } from './location-anchors.ts';

const fail = (): never => {
  throw new Error('위치 링크의 형식이나 버전을 확인해주세요.');
};
const validId = (value: string) =>
  value.length > 0 &&
  value.length <= 1024 &&
  ![...value].some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );

export function validateLocationTarget(value: unknown): LocationTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail();
  const target = value as LocationTarget;
  if (
    Object.keys(target).some(
      (key) => !['kind', 'id', 'blockId'].includes(key),
    ) ||
    !['document', 'file', 'html', 'drawing'].includes(target.kind) ||
    typeof target.id !== 'string' ||
    !validId(target.id)
  )
    return fail();
  if (
    target.kind === 'file' &&
    (/[\\:?#]/.test(target.id) ||
      target.id.startsWith('/') ||
      target.id
        .split('/')
        .some((part) => !part || part === '.' || part === '..'))
  )
    return fail();
  if (
    target.blockId !== undefined &&
    (!validLocationAnchor(target.blockId) || target.kind === 'html')
  )
    return fail();
  return {
    kind: target.kind,
    id: target.id,
    ...(target.blockId ? { blockId: target.blockId } : {}),
  };
}

/** Deliberately independent of browser/Node URL globals. No credentials or host redirects. */
export function parseLocationLink(raw: unknown): LocationLink {
  if (typeof raw !== 'string' || raw.length > 8192) return fail();
  // Windows ShellExecute canonicalizes the authority to `open/` before handing it to the app.
  const match = /^gamejam:\/\/open\/?\?([^#\s]+)$/.exec(raw);
  if (!match) return fail();
  const entries: Record<string, string> = Object.create(null);
  for (const part of match[1].split('&')) {
    const pair = /^([^=]+)=(.*)$/.exec(part);
    if (
      !pair ||
      !['v', 'project', 'kind', 'id', 'block'].includes(pair[1]) ||
      Object.hasOwn(entries, pair[1])
    )
      return fail();
    try {
      entries[pair[1]] = decodeURIComponent(pair[2]);
    } catch {
      return fail();
    }
  }
  if (
    entries.v !== '1' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      entries.project ?? '',
    )
  )
    return fail();
  return {
    version: 1,
    projectId: entries.project,
    target: validateLocationTarget({
      kind: entries.kind,
      id: entries.id,
      ...(entries.block ? { blockId: entries.block } : {}),
    }),
  };
}

export function locationLinkHref(link: LocationLink): string {
  validateLocationTarget(link.target);
  const href = `gamejam://open?v=1&project=${encodeURIComponent(link.projectId)}&kind=${link.target.kind}&id=${encodeURIComponent(link.target.id)}${link.target.blockId ? `&block=${encodeURIComponent(link.target.blockId)}` : ''}`;
  parseLocationLink(href);
  return href;
}

export function resolveLocationItem(
  target: LocationTarget,
  items: LocationItem[],
): LocationItem {
  const valid = validateLocationTarget(target);
  const matches = items.filter((item) =>
    valid.kind === 'file'
      ? item.relativePath === valid.id
      : item.target.kind === valid.kind && item.target.id === valid.id,
  );
  // A path is only a fallback. Never silently pick the first duplicate identity.
  if (matches.length !== 1)
    throw Error(
      matches.length
        ? '링크 대상을 구분할 수 없습니다.'
        : '링크 대상이 삭제되었거나 이동했습니다.',
    );
  return !valid.blockId
    ? matches[0]
    : {
        ...matches[0],
        target: { ...matches[0].target, blockId: valid.blockId },
        blockMissing:
          matches[0].blockIds?.filter((id) => id === valid.blockId).length !==
          1,
      };
}

export type LocationBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export function locationViewport(
  bounds: LocationBounds,
  width: number,
  height: number,
  readable = false,
) {
  if (
    ![bounds.x, bounds.y, bounds.width, bounds.height, width, height].every(
      Number.isFinite,
    ) ||
    bounds.width < 0 ||
    bounds.height < 0 ||
    width <= 0 ||
    height <= 0
  )
    throw Error('대상의 표시 크기를 확인할 수 없습니다.');
  const margin = 64;
  const zoom = Math.min(
    1,
    Math.max(1, width - margin * 2) / Math.max(1, bounds.width),
    Math.max(1, height - margin * 2) /
      Math.max(1, readable ? Math.min(bounds.height, 460) : bounds.height),
  );
  if (!(zoom > 0)) throw Error('대상의 표시 크기를 확인할 수 없습니다.');
  const visibleHeight = readable
    ? Math.min(bounds.height, Math.max(1, height - margin * 2) / zoom)
    : bounds.height;
  return {
    x: width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: height / 2 - (bounds.y + visibleHeight / 2) * zoom,
    zoom,
  };
}
