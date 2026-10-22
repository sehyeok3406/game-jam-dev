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

/** Strip encrypted session material before passing a registry entry to application code. */
export function homeProjectRegistry(
  library: ProjectLibrary,
): HomeProjectRegistry {
  return {
    list: () => library.list(),
    hasSharedSession: (id) => !!library.get(id).credentials,
    get: (id) => {
      const {
        credentials: _credentials,
        localRoot: _localRoot,
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
        options.userData,
        'shared-workspaces',
        library.get(id).projectId!,
        'server-cache.json',
      ),
    );
  return {
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
