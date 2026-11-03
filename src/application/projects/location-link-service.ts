import type {
  LocationItem,
  LocationOpenResult,
  LocationTarget,
} from '../../contracts/location-links.ts';
import type { ProjectEntry, WorkspaceState } from '../../contracts/project.ts';
import {
  locationLinkHref,
  parseLocationLink,
  resolveLocationItem,
  validateLocationTarget,
} from '../../core/projects/location-links.ts';

type Ports = {
  projects(): ProjectEntry[];
  hasSession(id: string): boolean;
  current(): { projectId?: string; key: string };
  verify(id: string): Promise<LocationItem[] | void>;
  open(id: string): Promise<WorkspaceState>;
  workspace(): WorkspaceState | Promise<WorkspaceState>;
  items(): LocationItem[];
  assertReady(): void;
};

/** Shares existing credentials, project transition and save queues; never joins from a URL. */
export class LocationLinkService {
  private ports: Ports;
  constructor(ports: Ports) {
    this.ports = ports;
  }
  async open(href: string, entryId?: string): Promise<LocationOpenResult> {
    const link = parseLocationLink(href),
      p = this.ports;
    let candidates = p
      .projects()
      .filter(
        (entry) =>
          entry.kind === 'shared' &&
          entry.projectId === link.projectId &&
          (!entryId || entry.id === entryId),
      );
    if (!entryId && candidates.filter((entry) => entry.current).length === 1)
      candidates = candidates.filter((entry) => entry.current);
    if (!candidates.length)
      throw Error(
        '이 PC에 프로젝트 참여 기록이 없습니다. 먼저 초대 코드로 참여해주세요.',
      );
    if (candidates.length !== 1)
      throw Error(
        '같은 프로젝트의 연결이 여러 개입니다. 사용할 프로젝트를 먼저 열어주세요.',
      );
    const entry = candidates[0];
    if (!p.hasSession(entry.id))
      throw Error('프로젝트 참여 자격이 없습니다. 다시 참여해주세요.');
    if (entry.lifecycle && entry.lifecycle.status !== 'active')
      throw Error('휴지통의 프로젝트는 먼저 복원해주세요.');
    const key = p.current().key;
    const verifiedItems = await p.verify(entry.id);
    if (key !== p.current().key)
      throw Error('프로젝트가 변경되었습니다. 링크를 다시 열어주세요.');
    if (verifiedItems) resolveLocationItem(link.target, verifiedItems);
    await p.open(entry.id);
    if (p.current().projectId !== link.projectId)
      throw Error('프로젝트 연결이 변경되었습니다.');
    p.assertReady();
    const item = resolveLocationItem(link.target, p.items());
    return { workspace: await p.workspace(), item };
  }
  async create(target: LocationTarget): Promise<string> {
    target = validateLocationTarget(target);
    const p = this.ports,
      current = p.current();
    if (!current.projectId)
      throw Error('위치 링크는 공동 프로젝트에서 복사할 수 있습니다.');
    const candidates = p
      .projects()
      .filter(
        (entry) =>
          entry.kind === 'shared' &&
          entry.projectId === current.projectId &&
          entry.current,
      );
    const entry = candidates[0];
    if (!entry || !p.hasSession(entry.id))
      throw Error('현재 프로젝트의 참여 자격을 확인할 수 없습니다.');
    p.assertReady();
    await p.verify(entry.id);
    if (p.current().key !== current.key)
      throw Error('프로젝트가 변경되었습니다. 다시 복사해주세요.');
    p.assertReady();
    const item = resolveLocationItem(target, p.items());
    if (item.blockMissing)
      throw Error(
        '문단 위치를 서버에서 확인하지 못했습니다. 저장을 마친 뒤 다시 복사해주세요.',
      );
    return locationLinkHref({
      version: 1,
      projectId: current.projectId,
      target,
    });
  }
}
