import type { Snapshot } from '../../contracts/project.ts';
import type { ProjectLayoutStatus } from '../../contracts/project-layout.ts';
import { readProjectLayout } from '../../core/projects/project-layout.ts';
import type { MarkdownCodec } from '../ports/markdown-codec.ts';
import {
  planProjectLayout,
  type LayoutMarkdownLinks,
} from './layout-migration.ts';

type Ports = {
  capture(): Promise<Snapshot>;
  assertCurrent(): void;
  blocked(): string | undefined;
  shared(): { supported: boolean; connected: boolean; admin: boolean } | null;
  preserve(): Promise<void>;
  pause(): Promise<() => Promise<void>>;
  install(files: Snapshot): Promise<void>;
  upgradeShared?(): Promise<Snapshot>;
  record(before: Snapshot, after: Snapshot): Promise<void>;
  validate(files: Snapshot): void;
  changed(): void;
  markdown: MarkdownCodec;
  links: LayoutMarkdownLinks;
};
export class ProjectLayoutService {
  private ports: Ports;
  constructor(ports: Ports) {
    this.ports = ports;
  }
  async status(): Promise<ProjectLayoutStatus> {
    const p = this.ports;
    p.assertCurrent();
    const files = await p.capture();
    p.assertCurrent();
    if (readProjectLayout(files)) return { version: 2, canUpgrade: false };
    const shared = p.shared();
    const reason =
      p.blocked() ??
      (shared &&
        (!shared.supported
          ? '협업 서버를 업데이트한 뒤 정리할 수 있습니다.'
          : !shared.connected
            ? '서버 연결 후 정리할 수 있습니다.'
            : !shared.admin
              ? '관리자만 공동 프로젝트의 파일 구조를 정리할 수 있습니다.'
              : undefined));
    return { version: 1, canUpgrade: !reason, reason: reason || undefined };
  }
  async upgrade(): Promise<ProjectLayoutStatus> {
    const p = this.ports;
    await p.preserve();
    const status = await this.status();
    if (status.version === 2) return status;
    if (!status.canUpgrade) throw Error(status.reason);
    const before = await p.capture();
    p.assertCurrent();
    const resume = await p.pause();
    try {
      const after = p.shared()
        ? await p.upgradeShared!()
        : planProjectLayout(before, p.markdown, p.links);
      p.assertCurrent();
      p.validate(after);
      await p.install(after);
      p.assertCurrent();
      if (!p.shared()) await p.record(before, after);
      p.changed();
      return { version: 2, canUpgrade: false };
    } finally {
      await resume();
    }
  }
}
