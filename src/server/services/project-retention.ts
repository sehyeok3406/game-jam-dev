import path from 'node:path';
import type { Project } from '../project-state.ts';
import { statDirectory, moveChecked, purgeChecked } from '../../trash-files.ts';
/** Only UUID-named children; checked filesystem helpers retain identity/link guards. */
export function createProjectRetention(root: string) {
  const uuid = (id: string) => {
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw Error('서버 휴지통 경로가 올바르지 않습니다.');
    return id;
  };
  const live = (id: string) => path.join(root, uuid(id));
  const retained = (p: Project) => {
    uuid(p.id);
    return path.join(
      root,
      '.project-trash',
      uuid(p.lifecycle!.trashId),
      'project',
    );
  };
  return {
    identity: (id: string) => statDirectory(live(id)),
    retain: (p: Project) =>
      moveChecked(live(p.id), retained(p), p.lifecycle!.identity),
    restore: (p: Project) =>
      moveChecked(retained(p), live(p.id), p.lifecycle!.identity),
    purge: (p: Project) =>
      purgeChecked(retained(p), retained(p), p.lifecycle!.identity),
  };
}
