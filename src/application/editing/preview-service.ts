import type { LocalProjectRepository } from '../ports/local-project-repository.ts';
import type { ProjectTextFiles } from '../ports/text-files.ts';
import type { PreviewWindowState } from '../../contracts/preview.ts';
import { normalizePreviewWindow } from '../../preview-window.ts';
import {
  DEFAULT_PREVIEW_PATH,
  assertPreviewPath,
  isPreviewPath,
  previewVersion,
  previewWindowPath,
} from '../../preview-output.ts';
import { describePreview } from '../../html-source.ts';

type PreviewPorts = {
  project: LocalProjectRepository;
  files: ProjectTextFiles;
  mutate: (action: () => Promise<void>) => Promise<void>;
  assertUnlocked: (paths: string[]) => void;
};
export class ProjectPreviewService {
  private ports: PreviewPorts;
  constructor(ports: PreviewPorts) {
    this.ports = ports;
  }
  async list() {
    const files = await this.ports.project.capture();
    return Object.keys(files)
      .filter(isPreviewPath)
      .sort((a, b) => previewVersion(a) - previewVersion(b))
      .map((path) => describePreview(files, path));
  }
  async read(relative = DEFAULT_PREVIEW_PATH) {
    assertPreviewPath(relative);
    const raw = await this.ports.files.read(relative);
    return { exists: raw !== null, content: raw ?? '', relativePath: relative };
  }
  async window(relative = DEFAULT_PREVIEW_PATH) {
    const raw = await this.ports.files.read(previewWindowPath(relative));
    return raw === null ? null : normalizePreviewWindow(JSON.parse(raw));
  }
  saveWindow(state: PreviewWindowState, relative = DEFAULT_PREVIEW_PATH) {
    const windowPath = previewWindowPath(relative);
    if (
      ![state.x, state.y, state.width, state.height].every(Number.isFinite) ||
      typeof state.collapsed !== 'boolean'
    )
      throw Error('올바르지 않은 창 상태입니다.');
    return this.ports.mutate(async () => {
      this.ports.assertUnlocked([relative, windowPath]);
      const old = await this.ports.files.read(windowPath);
      await this.ports.files.replace(
        windowPath,
        old,
        JSON.stringify(normalizePreviewWindow(state)),
      );
    });
  }
}
