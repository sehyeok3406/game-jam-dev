import type { ProjectEntry, ProjectFolder } from './shared.ts';

export type HomeOrganization = {
  folders: ProjectFolder[];
  projects: { id: string; folderId?: string }[];
};
export type HomeEdit =
  | { type: 'move-project'; id: string; folderId: string | null }
  | { type: 'create-folder' | 'rename-folder'; id: string; name: string }
  | { type: 'remove-folder'; id: string };

export function homeName(value: string) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > 100 ||
    [...value].some((char) => char.charCodeAt(0) < 32)
  )
    throw new Error(
      '이름을 1~100자로 입력해주세요. 공백만 입력하거나 줄바꿈을 사용할 수 없습니다.',
    );
  return value.trim();
}

export function readHomeOrganization(raw: string): HomeOrganization {
  const value = JSON.parse(raw) as HomeOrganization;
  if (!value || !Array.isArray(value.folders) || !Array.isArray(value.projects))
    throw new Error('홈 분류 정보를 읽을 수 없습니다.');
  const folders = value.folders.map((folder) => {
    if (!folder || typeof folder.id !== 'string' || !folder.id)
      throw new Error('홈 폴더 정보가 올바르지 않습니다.');
    return { id: folder.id, name: homeName(folder.name) };
  });
  if (new Set(folders.map((folder) => folder.id)).size !== folders.length)
    throw new Error('홈 폴더 ID가 중복되었습니다.');
  const projects = value.projects.map((project) => {
    if (!project || typeof project.id !== 'string' || !project.id)
      throw new Error('홈 프로젝트 정보가 올바르지 않습니다.');
    if (
      project.folderId !== undefined &&
      !folders.some((folder) => folder.id === project.folderId)
    )
      throw new Error('홈 프로젝트의 분류 폴더를 찾을 수 없습니다.');
    return {
      id: project.id,
      ...(project.folderId === undefined ? {} : { folderId: project.folderId }),
    };
  });
  if (new Set(projects.map((project) => project.id)).size !== projects.length)
    throw new Error('홈 프로젝트 ID가 중복되었습니다.');
  // Pick only public display fields. Credentials are never copied into this file.
  return { folders, projects };
}

export function displayHomeProjects(
  entries: ProjectEntry[],
  home: HomeOrganization,
) {
  return entries.map((entry) => {
    const settings = home.projects.find((project) => project.id === entry.id);
    return {
      ...entry,
      ...(settings?.folderId ? { folderId: settings.folderId } : {}),
    };
  });
}

export function editHomeOrganization(
  home: HomeOrganization,
  edit: HomeEdit,
): HomeOrganization {
  const next = structuredClone(home);
  if (edit.type === 'move-project') {
    let project = next.projects.find((item) => item.id === edit.id);
    if (!project) {
      project = { id: edit.id };
      next.projects.push(project);
    }
    if (
      edit.folderId !== null &&
      !next.folders.some((folder) => folder.id === edit.folderId)
    )
      throw new Error('이동할 홈 폴더를 찾을 수 없습니다.');
    if (edit.folderId === null) delete project.folderId;
    else project.folderId = edit.folderId;
    return next;
  }
  const folder = next.folders.find((item) => item.id === edit.id);
  if (edit.type !== 'create-folder' && !folder)
    throw new Error('홈 폴더를 찾을 수 없습니다.');
  if (edit.type === 'remove-folder') {
    next.folders = next.folders.filter((item) => item.id !== edit.id);
    for (const project of next.projects)
      if (project.folderId === edit.id) delete project.folderId;
  } else {
    const name = homeName(edit.name);
    if (
      next.folders.some(
        (item) =>
          item.id !== edit.id &&
          item.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    )
      throw new Error('같은 이름의 홈 폴더가 이미 있습니다.');
    if (edit.type === 'create-folder') {
      if (folder) throw new Error('홈 폴더 ID가 중복되었습니다.');
      next.folders.push({ id: edit.id, name });
    } else folder!.name = name;
  }
  return next;
}
