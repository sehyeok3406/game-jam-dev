import {
  FilesystemSharedWorkspaces,
  sharedWorkspacePath,
} from '../../adapters/filesystem/shared-workspace-locations.ts';
import type { ProjectLibrary } from '../../project-library.ts';

export function sharedWorkspaceLocations(
  userData: string,
  library: ProjectLibrary,
) {
  return new FilesystemSharedWorkspaces(userData, {
    get: (id) => library.get(id),
    setRoot: (id, root) => library.setSharedRoot(id, root),
    assertName: (name, id) => library.assertNameAvailable(name, id),
  });
}
export function registeredSharedWorkspace(
  userData: string,
  library: ProjectLibrary,
  projectId: string,
  serverUrl?: string,
) {
  let entry;
  try {
    entry = library.findShared(projectId, serverUrl);
  } catch {
    if (
      library
        .list()
        .some((item) => item.kind === 'shared' && item.projectId === projectId)
    )
      throw Error(
        '공동 프로젝트 연결이 여러 서버에 있습니다. 프로젝트 카드를 선택해주세요.',
      );
    entry = { id: `shared:${projectId}`, name: '', projectId };
  }
  return sharedWorkspacePath(userData, entry);
}
