import { sharedWorkspaceLocations } from './workspace-locations.ts';
import { sharedWorkspacePath } from '../../adapters/filesystem/shared-workspace-locations.ts';
import path from 'node:path';
import {
  CollaborationClient,
  type CollaborationCredentials,
} from '../../collaboration-client.ts';
import { readClientCache } from '../../client-cache.ts';
import type { ProjectLibrary } from '../../project-library.ts';
import type {
  HomeSharedProjects,
  HomeProjectRegistry,
} from '../../application/ports/home-projects.ts';
import type { SharedProjectLifecycle } from '../../contracts/project.ts';
import type { CollaborationEnvelope } from '../../collaboration-server.ts';
import type { Snapshot } from '../../contracts/project.ts';
import fs from 'node:fs/promises';
import { writeClientCache } from '../../client-cache.ts';
import { hasModernLayout } from '../../adapters/filesystem/project-location.ts';
import { PROJECT_LAYOUT_PATH } from '../../contracts/project-layout.ts';

/** Strip encrypted session material before passing a registry entry to application code. */
export function homeProjectRegistry(
  library: ProjectLibrary,
): HomeProjectRegistry {
  return {
    list: () => library.list(),
    withName: (name, exceptId, operation) =>
      library.withName(name, exceptId, operation),
    assertNameAvailable: (name, exceptId) =>
      library.assertNameAvailable(name, exceptId),
    observeName: (...args) => library.observeName(...args),
    hasSharedSession: (id) => !!library.get(id).credentials,
    findShared: (projectId, serverUrl) => {
      const entry = library.findShared(projectId, serverUrl);
      return library.list().find((item) => item.id === entry.id)!;
    },
    get: (id) => {
      const {
        credentials: _credentials,
        localRoot: _localRoot,
        sharedRoot: _sharedRoot,
        ...entry
      } = library.get(id);
      return entry;
    },
    listFolders: () => library.listFolders(),
    renameProject: (...args) => library.renameProject(...args),
    updateServer: (...args) => library.updateServer(...args),
    moveProject: (...args) => library.moveProject(...args),
    createFolder: (...args) => library.createFolder(...args),
    renameFolder: (...args) => library.renameFolder(...args),
    removeFolder: (...args) => library.removeFolder(...args),
  };
}

type Options = {
  beginReveal?: () => () => void;
  prepareFiles?: (
    root: string,
    files: Snapshot,
    assertCurrent: () => void,
  ) => Promise<void>;
  library: ProjectLibrary;
  userData: string;
  active(): CollaborationClient | null;
  internalServerUrl(): Promise<string>;
  drainCache(): Promise<void>;
  // Injection is also used by transport tests; defaults are the existing authenticated client.
  fetch?: typeof CollaborationClient.fetch;
  client?(
    credentials: CollaborationCredentials,
  ): Pick<CollaborationClient, 'refresh' | 'renameProject' | 'state'>;
};
export function desktopSharedProjects(options: Options): HomeSharedProjects {
  const { library } = options;
  const fetch =
    options.fetch ??
    ((...args: Parameters<typeof CollaborationClient.fetch>) =>
      CollaborationClient.fetch(...args));
  const credentials = async (id: string) => {
    const entry = library.get(id);
    if (!entry.credentials) throw Error('공동 프로젝트를 선택해주세요.');
    const saved = entry.credentials;
    return {
      ...saved,
      serverUrl: saved.internalServer
        ? await options.internalServerUrl()
        : saved.serverUrl,
    };
  };
  const cache = (id: string) =>
    readClientCache(
      path.join(
        sharedWorkspacePath(options.userData, library.get(id)),
        'server-cache.json',
      ),
    );
  return {
    async directory(id) {
      const assertSession = options.beginReveal?.() ?? (() => {});
      const entry = library.get(id);
      const projectId = entry.projectId!;
      let root = sharedWorkspacePath(options.userData, entry);
      const assertCurrent = () => {
        assertSession();
        const current = library.get(id);
        if (
          current.kind !== 'shared' ||
          current.projectId !== projectId ||
          (current.lifecycle && current.lifecycle.status !== 'active')
        )
          throw Error('프로젝트 연결이 변경되었습니다. 다시 표시해주세요.');
      };
      assertCurrent();
      await options.drainCache();
      const saved = await credentials(id);
      assertCurrent();
      const cached = await cache(id).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      const active = options.active();
      let envelope: CollaborationEnvelope | null = null;
      let offline = false;
      if (active?.credentials.projectId === projectId) {
        if (active.state.accessDenied || active.state.projectDeleted)
          throw Error('이 프로젝트에 접근할 수 없습니다.');
        if (!active.offline && !active.outgoing) {
          try {
            await active.refresh();
          } catch (error) {
            const status =
              (error as { status?: number; details?: { status?: number } })
                .status ??
              (error as { details?: { status?: number } }).details?.status;
            if (
              (status && status < 500) ||
              active.state.accessDenied ||
              active.state.projectDeleted ||
              (!Object.keys(active.files).length && !cached)
            )
              throw error;
          }
        }
        assertCurrent();
        if (active.state.accessDenied || active.state.projectDeleted)
          throw Error('이 프로젝트에 접근할 수 없습니다.');
        envelope = {
          files: { ...active.files },
          state: active.state,
          revisions: active.revisions,
        };
        offline =
          !active.state.connected || !!active.offline || !!active.outgoing;
      } else if (cached?.offline || cached?.outgoing) {
        envelope = {
          ...cached,
          files:
            cached.offline?.local ?? cached.outgoing?.local ?? cached.files,
        };
        offline = true;
      } else {
        try {
          envelope = (await fetch(
            saved.serverUrl,
            `/projects/${projectId}/state`,
            {},
            saved.token,
          )) as CollaborationEnvelope;
        } catch (error) {
          const status =
            (error as { status?: number; details?: { status?: number } })
              .status ??
            (error as { details?: { status?: number } }).details?.status;
          if (
            (status && status < 500) ||
            (error as { lifecycle?: unknown }).lifecycle
          )
            throw error;
          if (!cached)
            throw Error(
              '이 PC에 준비된 사본이 없습니다. 서버 연결 후 다시 표시해주세요.',
            );
          envelope = cached;
          offline = true;
        }
      }
      assertCurrent();
      if (
        !envelope ||
        envelope.state.projectDeleted ||
        envelope.state.accessDenied
      )
        throw Error('이 프로젝트에 접근할 수 없습니다.');
      root = await sharedWorkspaceLocations(options.userData, library).ensure(
        id,
      );
      assertCurrent();
      await fs.mkdir(root, { recursive: true });
      if (!options.prepareFiles)
        throw Error('프로젝트 파일 사본을 준비할 수 없는 환경입니다.');
      if (
        !(
          offline &&
          !envelope.files[PROJECT_LAYOUT_PATH] &&
          (await hasModernLayout(root))
        )
      )
        await options.prepareFiles(root, envelope.files, assertCurrent);
      assertCurrent();
      if (!offline && active?.credentials.projectId !== projectId)
        await writeClientCache(root, envelope);
      return { root, offline };
    },
    async cache(id) {
      const cached = await cache(id);
      return {
        pendingChanges: cached.offline
          ? Object.keys({
              ...cached.offline.base,
              ...cached.offline.local,
            }).filter(
              (key) => cached.offline!.base[key] !== cached.offline!.local[key],
            ).length
          : cached.outgoing
            ? 1
            : 0,
        role: cached.state?.role,
        createdAt: cached.state?.projectCreatedAt,
        modifiedAt: cached.state?.projectModifiedAt,
      };
    },
    async lifecycle(id, action, input = {}) {
      const saved = await credentials(id);
      try {
        const result = (await fetch(
          saved.serverUrl,
          `/projects/${saved.projectId}/${action}`,
          input,
          saved.token,
        )) as SharedProjectLifecycle;
        await library.updateLifecycle(id, result);
        return result;
      } catch (error) {
        const lifecycle = (error as { lifecycle?: SharedProjectLifecycle })
          .lifecycle;
        if (action === 'lifecycle' && lifecycle) {
          await library.updateLifecycle(id, lifecycle);
          return lifecycle;
        }
        throw error;
      }
    },
    async metadata(id) {
      const saved = await credentials(id);
      const result = (await fetch(
        saved.serverUrl,
        `/projects/${saved.projectId}/state`,
        { metadataOnly: true },
        saved.token,
      )) as CollaborationEnvelope;
      return {
        name: result.state.projectName ?? library.get(id).name,
        role: result.state.role,
        createdAt: result.state.projectCreatedAt,
        modifiedAt: result.state.projectModifiedAt,
      };
    },
    async rename(id, name, expectedName) {
      await options.drainCache();
      const cached = await cache(id);
      if (cached.offline || cached.outgoing)
        throw Error(
          '공동 프로젝트를 열어 미동기화 작업을 반영한 뒤 이름을 변경해주세요.',
        );
      const entry = library.get(id);
      const active = options.active();
      const client =
        active && active.credentials.projectId === entry.projectId
          ? active
          : (options.client?.(await credentials(id)) ??
            new CollaborationClient(await credentials(id), () => {}));
      await client.refresh();
      await client.renameProject(name, expectedName);
      return { name: client.state.projectName!, role: client.state.role };
    },
  };
}
