import type {
  CanvasDocument,
  ImportBatchInput,
} from '../../contracts/documents.ts';
import type { Snapshot } from '../../contracts/project.ts';
import type { LocalProjectRepository } from '../ports/local-project-repository.ts';
import { applyCommand, snapshotChanges } from './command-service.ts';
import { snapshotDocuments } from '../../collaboration-model.ts';
import { initializeWorkflows } from '../../document-workflow.ts';
import { CanvasError } from '../../app-errors.ts';

type ClipboardImport = {
  assertCurrent: () => void;
  cancelled: () => boolean;
  record: (before: Snapshot, after: Snapshot) => Promise<void>;
};
type SharedImport = {
  state: () => { connected: boolean; role?: string };
  command: (input: ImportBatchInput) => Promise<CanvasDocument[]>;
  acknowledge: () => void;
  changed: () => void;
};
type ImportPorts = {
  assertCurrent: () => void;
  shared?: SharedImport;
  repository?: LocalProjectRepository;
  assertMutation?: (before: Snapshot, after: Snapshot) => void;
};
export function assertImportAccess(state?: {
  connected: boolean;
  role?: string;
}) {
  if (state && (!state.connected || state.role === 'viewer'))
    throw new CanvasError(
      'GC-IMPORT-001',
      '연결된 관리자·편집자만 파일을 불러올 수 있습니다.',
    );
}

/** Imported data uses one application path for native files and clipboard images. */
export class FileImportService {
  private ports: ImportPorts;
  constructor(ports: ImportPorts) {
    this.ports = ports;
  }
  async import(
    input: ImportBatchInput,
    clipboard?: ClipboardImport,
  ): Promise<CanvasDocument[]> {
    const { shared, repository, assertCurrent } = this.ports;
    assertCurrent();
    if (shared) {
      assertImportAccess(shared.state());
      const result = await shared.command(input);
      assertCurrent();
      shared.acknowledge();
      shared.changed();
      return result;
    }
    if (!repository) throw Error('파일 저장소가 연결되지 않았습니다.');
    const before = await repository.capture();
    clipboard?.assertCurrent();
    const reduced = applyCommand(before, 'files:import-batch', input);
    const after = clipboard
      ? initializeWorkflows(before, reduced.files)
      : reduced.files;
    this.ports.assertMutation?.(before, after);
    const changes = snapshotChanges(before, after);
    await repository.apply(before, changes, clipboard?.cancelled);
    if (clipboard) {
      try {
        await clipboard.record(before, after);
      } catch (error) {
        await repository
          .apply(
            after,
            Object.fromEntries(
              Object.keys(changes).map((path) => [path, before[path] ?? null]),
            ),
          )
          .catch(() => {
            throw Error(
              `파일 기록과 복구에 실패했습니다. 프로젝트에서 확인할 파일: ${Object.keys(changes).join(', ')}`,
            );
          });
        throw error;
      }
    }
    return clipboard
      ? snapshotDocuments(
          Object.fromEntries(
            Object.entries(after).filter(
              ([path]) => before[path] === undefined,
            ),
          ),
        )
      : reduced.result;
  }
}
