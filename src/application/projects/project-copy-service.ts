import { projectCopyBundle } from '../../project-copy.ts';
import type {
  ProjectCopyRequest,
  ProjectCopyResult,
  ProjectCopyTarget,
  ProjectCopyImport,
} from '../../contracts/project-copy.ts';
import type { ProjectSessionRef } from '../../contracts/project-session.ts';
import type { Snapshot } from '../../contracts/project.ts';

export interface ProjectCopyDestination {
  info: ProjectCopyTarget;
  publish(input: ProjectCopyImport): Promise<ProjectCopyResult>;
  close(): void;
}
type Ports = {
  assertSource(session: ProjectSessionRef): void;
  source(): Promise<Snapshot>;
  assertReadable(paths: string[]): void;
  destination(id: string): Promise<ProjectCopyDestination>;
};

/** Source reads and target publication are separate; the active project never changes. */
export class ProjectCopyService {
  private ports: Ports;
  constructor(ports: Ports) {
    this.ports = ports;
  }
  async target(id: string) {
    const destination = await this.ports.destination(id);
    try {
      return destination.info;
    } finally {
      destination.close();
    }
  }
  async copy(input: ProjectCopyRequest) {
    if (!input || !/^[a-f0-9-]{36}$/i.test(input.requestId ?? ''))
      throw Error('복사 요청을 확인해주세요.');
    const p = this.ports;
    p.assertSource(input.session);
    const files = await p.source();
    p.assertSource(input.session);
    const bundle = projectCopyBundle(files, input.selection);
    p.assertReadable(Object.keys(bundle.files));
    const destination = await p.destination(input.targetId);
    try {
      p.assertSource(input.session);
      p.assertReadable(Object.keys(bundle.files));
      return await destination.publish({
        requestId: input.requestId,
        canvasId: input.canvasId,
        bundle,
      });
    } finally {
      destination.close();
    }
  }
}
