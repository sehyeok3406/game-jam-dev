import fs from 'node:fs/promises';
import path from 'node:path';
import { ProjectCopyService } from '../../application/projects/project-copy-service.ts';
import type { ProjectCopyDestination } from '../../application/projects/project-copy-service.ts';
import type { DesktopProjectSessions } from '../project-session.ts';
import { CollaborationClient } from '../../collaboration-client.ts';
import type { ProjectLibrary } from '../../project-library.ts';
import { readClientCache } from '../../client-cache.ts';
import { CANVAS_SHEETS_PATH, readCanvasSheets } from '../../canvas-sheets.ts';
import { captureProject } from '../../project-store.ts';
import { filesystemProjectRepository } from '../../adapters/filesystem/local-project-repository.ts';
import { LocalCommandService } from '../../application/editing/command-service.ts';
import { UserEditRecorder } from '../../application/editing/user-edit-recorder.ts';
import { EditJournal } from '../../edit-journal.ts';
import { COMMAND_LABELS } from '../../contracts/commands.ts';
import type {
  ProjectCopyRequest,
  ProjectCopyResult,
} from '../../contracts/project-copy.ts';
import type { IpcRegistrar } from '../ipc/types.ts';

type Ports = {
  sessions: DesktopProjectSessions<CollaborationClient>;
  library: ProjectLibrary;
  userData: string;
  internalServerUrl(): Promise<string>;
  trashed(id: string): boolean;
  journals: Map<string, EditJournal>;
  assertReadable(paths: string[]): void;
  assertSender(event: Parameters<Parameters<IpcRegistrar>[1]>[0]): void;
  changed(): void;
};
export function registerProjectCopyIpc(handle: IpcRegistrar, ports: Ports) {
  const journal = (key: string) => {
    let value = ports.journals.get(key);
    if (!value) ports.journals.set(key, (value = new EditJournal()));
    return value;
  };
  // Retain exact request results in-process, including errors after durable publication.
  const requests = new Map<
    string,
    { fingerprint: string; result: Promise<ProjectCopyResult> }
  >();
  const destination = async (id: string): Promise<ProjectCopyDestination> => {
    const entry = ports.library.get(id);
    if (
      ports.trashed(id) ||
      (entry.lifecycle && entry.lifecycle.status !== 'active')
    )
      throw Error('휴지통 또는 복구 중인 프로젝트에는 복사할 수 없습니다.');
    if (entry.kind === 'local') {
      if (!entry.root) throw Error('대상 프로젝트 경로를 찾을 수 없습니다.');
      const root = await fs.realpath(entry.root);
      if (
        ports.sessions.root &&
        root.toLowerCase() ===
          (await fs.realpath(ports.sessions.root)).toLowerCase()
      )
        throw Error('다른 프로젝트를 선택해주세요.');
      const repository = filesystemProjectRepository(root);
      const before = await repository.capture();
      const editJournal = journal(root);
      return {
        info: {
          id,
          name: entry.name,
          sheets: readCanvasSheets(before[CANVAS_SHEETS_PATH]),
        },
        close() {},
        async publish(input) {
          if (ports.trashed(id))
            throw Error('대상 프로젝트가 휴지통으로 이동되었습니다.');
          const historyId = `copy-${input.requestId}`;
          const recorded = (await repository.history()).find(
            (record) => record.id === historyId,
          );
          if (recorded) {
            editJournal.push({
              id: historyId,
              label: COMMAND_LABELS['projects:import-copy'],
            });
            // A restarted app can recognize a completed copy without creating it again.
            return {
              count:
                input.bundle.documents.length +
                input.bundle.sections.length +
                input.bundle.previews.length +
                input.bundle.drawings.length,
              paths: recorded.files.map((file) => file.relativePath),
              drawingIds: [],
              warnings: [],
            };
          }
          const plan = await new LocalCommandService(repository).plan(
            'projects:import-copy',
            input,
          );
          await repository.apply(plan.before, plan.changes);
          try {
            await new UserEditRecorder(repository, editJournal, {
              id: () => historyId,
              now: Date.now,
            }).record(
              plan.before,
              plan.files,
              COMMAND_LABELS['projects:import-copy'],
            );
          } catch (error) {
            await repository.apply(
              plan.files,
              Object.fromEntries(
                Object.keys(plan.changes).map((key) => [
                  key,
                  plan.before[key] ?? null,
                ]),
              ),
            );
            throw error;
          }
          ports.changed();
          return plan.result;
        },
      };
    }
    if (!entry.credentials)
      throw Error('공유 프로젝트의 연결 정보가 없습니다.');
    const credentials = { ...entry.credentials };
    if (credentials.internalServer)
      credentials.serverUrl = await ports.internalServerUrl();
    if (
      ports.sessions.client?.credentials.projectId === credentials.projectId &&
      ports.sessions.client.credentials.serverUrl === credentials.serverUrl
    )
      throw Error('다른 프로젝트를 선택해주세요.');
    const cached = await readClientCache(
      path.join(
        ports.userData,
        'shared-workspaces',
        credentials.projectId,
        'server-cache.json',
      ),
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (cached?.offline || cached?.outgoing)
      throw Error(
        '대상 프로젝트에 미동기화 자료가 있습니다. 먼저 열어 동기화를 완료해주세요.',
      );
    const client = new CollaborationClient(credentials, () => {});
    await client.refresh();
    if (!client.state.connected || client.state.projectCopyVersion !== 1)
      throw Error(
        '대상 협업 서버를 최신 버전으로 업데이트하고 다시 시작해주세요.',
      );
    if (!['admin', 'editor'].includes(client.state.role ?? ''))
      throw Error('대상 프로젝트의 쓰기 권한이 필요합니다.');
    if (client.state.projectDeleted || client.state.awaitingResume)
      throw Error('대상 프로젝트가 삭제되었거나 복구 확인이 필요합니다.');
    return {
      info: {
        id,
        name: client.state.projectName ?? entry.name,
        sheets: readCanvasSheets(client.files[CANVAS_SHEETS_PATH]),
      },
      close: () => client.stop(),
      async publish(input) {
        // command() keeps authenticated server receipts and retries the same creation ID.
        const result = (await client.command(
          'projects:import-copy',
          input,
        )) as ProjectCopyResult;
        if (client.lastCommandHistoryId)
          journal(`shared:${credentials.projectId}:${credentials.token}`).push({
            id: client.lastCommandHistoryId,
            label: COMMAND_LABELS['projects:import-copy'],
          });
        ports.changed();
        return result;
      },
    };
  };
  const service = new ProjectCopyService({
    destination,
    assertSource: (ref) => ports.sessions.assertCurrent(ref),
    source: async () => {
      const client = ports.sessions.client;
      if (client) {
        if (!client.state.connected || client.state.pendingChanges)
          throw Error('원본 공유 프로젝트의 온라인 동기화를 완료해주세요.');
        await client.refresh();
        if (
          !client.state.connected ||
          client.state.accessDenied ||
          client.state.pendingChanges
        )
          throw Error(
            '원본 프로젝트를 읽을 수 없습니다. 연결과 권한을 확인해주세요.',
          );
        return structuredClone(client.files);
      }
      if (!ports.sessions.root) throw Error('원본 프로젝트를 열어주세요.');
      return captureProject(ports.sessions.root);
    },
    assertReadable: ports.assertReadable,
  });
  handle('projects:copy-target', (event, id) => {
    ports.assertSender(event);
    return service.target(id);
  });
  handle('projects:copy-selection', (event, input: ProjectCopyRequest) => {
    ports.assertSender(event);
    const fingerprint = JSON.stringify(input);
    const key = input?.requestId;
    if (typeof key !== 'string') throw Error('복사 요청을 확인해주세요.');
    const existing = requests.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw Error('동일한 복사 요청의 대상이 변경되었습니다.');
      return existing.result;
    }
    const result = service.copy(input);
    requests.set(key, { fingerprint, result });
    void result.catch(() => {
      requests.delete(key);
    });
    if (requests.size > 100) requests.delete(requests.keys().next().value!);
    return result;
  });
}
