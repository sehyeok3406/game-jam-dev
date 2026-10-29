import type { LocalConversionInput } from '../../contracts/project-mode.ts';

export type ProjectModeAttempt = {
  commitRemote(): Promise<void>;
  finishLocal(): Promise<void>;
};
export type ProjectModePorts = {
  assertReady(): void;
  prepare(input: LocalConversionInput): Promise<ProjectModeAttempt>;
};
/** Durable local preparation must precede removal of remote membership. */
export class ProjectModeService {
  private ports: ProjectModePorts;
  constructor(ports: ProjectModePorts) {
    this.ports = ports;
  }
  async toLocal(input: LocalConversionInput) {
    this.ports.assertReady();
    const attempt = await this.ports.prepare(input);
    this.ports.assertReady();
    await attempt.commitRemote();
    // After remote commit, finishing is forward recovery, never a second departure.
    await attempt.finishLocal();
  }
}
