import type { ProjectTextFiles } from '../ports/text-files.ts';
import {
  DOCUMENT_STATUSES_PATH,
  readStatuses,
} from '../../document-statuses.ts';
import {
  KANBAN_VIEW_PATH,
  readKanbanView,
} from '../../features/kanban/view.ts';
export class ProjectSettingsService {
  private files: ProjectTextFiles;
  constructor(files: ProjectTextFiles) {
    this.files = files;
  }
  async statuses() {
    const raw = await this.files.read(DOCUMENT_STATUSES_PATH);
    return { value: readStatuses(raw), raw };
  }
  async kanban() {
    const [raw, statuses] = await Promise.all([
      this.files.read(KANBAN_VIEW_PATH),
      this.files.read(DOCUMENT_STATUSES_PATH),
    ]);
    return { value: readKanbanView(raw, readStatuses(statuses)), raw };
  }
}
