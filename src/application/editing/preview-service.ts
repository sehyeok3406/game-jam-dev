import { readFileNames } from '../../core/documents/name-registry.ts';
import { FILE_NAMES_PATH } from '../../contracts/document-names.ts';
import type { LocalProjectRepository } from '../ports/local-project-repository.ts';
import type { ProjectTextFiles } from '../ports/text-files.ts';
import type { PreviewWindowState } from '../../contracts/preview.ts';
import { normalizePreviewWindow } from '../../preview-window.ts';
import {
  DEFAULT_PREVIEW_PATH,
  assertPreviewPath,
  managedPreviewPaths,
  previewWindowPath,
} from '../../preview-output.ts';
import { describePreview, htmlSourceId } from '../../html-source.ts';

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
    return managedPreviewPaths(files)
      .map((path) => describePreview(files, path))
      .sort((a, b) => a.version! - b.version!);
  }
  async read(relative = DEFAULT_PREVIEW_PATH) {
    assertPreviewPath(relative);
    const raw = await this.ports.files.read(relative);
    return { exists: raw !== null, content: raw ?? '', relativePath: relative };
  }
  async window(relative = DEFAULT_PREVIEW_PATH) {
    const entry = await this.nameEntry(relative);
    const raw =
      (await this.ports.files.read(this.windowPath(relative, entry?.id))) ??
      (await this.ports.files.read(
        previewWindowPath(entry?.originalPath ?? relative),
      ));
    return raw === null ? null : normalizePreviewWindow(JSON.parse(raw));
  }
  async saveWindow(state: PreviewWindowState, relative = DEFAULT_PREVIEW_PATH) {
    const windowPath = this.windowPath(
      relative,
      (await this.nameEntry(relative))?.id,
    );
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
  private async nameEntry(relative: string) {
    assertPreviewPath(relative);
    const raw = await this.ports.files.read(FILE_NAMES_PATH);
    return readFileNames(
      raw === null ? {} : { [FILE_NAMES_PATH]: raw },
    ).entries.find((e) => e.kind === 'html' && e.path === relative);
  }
  private windowPath(relative: string, id?: string) {
    return `.canvas/previews/${id ?? htmlSourceId(relative)}.json`;
  }
}
