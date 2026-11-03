import type { LocationLinkService } from '../../application/projects/location-link-service.ts';
import type { LocationLinkInbox } from '../location-link-inbox.ts';
import type { ProjectSessionRef } from '../../contracts/project-session.ts';
import type { IpcRegistrar } from './types.ts';

export function registerLocationLinksIpc(
  handle: IpcRegistrar,
  read: IpcRegistrar,
  service: LocationLinkService,
  inbox: LocationLinkInbox,
  assertSender: (event: Parameters<Parameters<IpcRegistrar>[1]>[0]) => void,
  current: () => ProjectSessionRef | null,
) {
  const assertSession = (expected: ProjectSessionRef | null) => {
    const actual = current();
    if (
      expected == null
        ? actual != null
        : expected.sessionId !== actual?.sessionId ||
          expected.epoch !== actual?.epoch ||
          expected.projectKey !== actual?.projectKey
    )
      throw Error('프로젝트가 변경되었습니다. 위치 링크를 다시 열어주세요.');
  };
  handle('projects:location-open', (event, href, expected, entryId) => {
    assertSender(event);
    assertSession(expected);
    if (entryId !== undefined && typeof entryId !== 'string')
      throw Error('프로젝트 선택을 확인해주세요.');
    return service.open(href, entryId);
  });
  handle('projects:location-create', (event, target, expected) => {
    assertSender(event);
    assertSession(expected);
    return service.create(target);
  });
  read('location-links:pending', (event) => {
    assertSender(event);
    return inbox.pending();
  });
  read('location-links:acknowledge', (event, id) => {
    assertSender(event);
    if (!Number.isSafeInteger(id))
      throw Error('위치 링크 요청을 확인해주세요.');
    inbox.acknowledge(id);
  });
}
