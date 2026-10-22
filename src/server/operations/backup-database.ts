import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SqliteProjectStore } from '../../adapters/sqlite/project-repository.ts';
import { assertSchema } from '../../adapters/sqlite/migrations.ts';
import type { Project } from '../project-state.ts';
import { checkSnapshot } from '../../collaboration-model.ts';
import { uuid } from './backup-files.ts';
import { createHash } from 'node:crypto';
import { statDirectory } from '../../trash-files.ts';
import { isAssetPath, decodeAsset } from '../../file-assets.ts';

export type ProjectSummary = {
  id: string;
  revision: number;
  lifecycle: {
    status: string;
    version: number;
    trashId?: string;
    identity?: string | null;
  };
};
export function inspectDatabase(filename: string) {
  const db = new DatabaseSync(filename, { readOnly: true });
  let schemaVersion: number;
  try {
    schemaVersion = assertSchema(db);
    const checks = db.prepare('PRAGMA integrity_check').all();
    if (checks.length !== 1 || checks[0].integrity_check !== 'ok')
      throw new Error('백업 SQLite 무결성 검사에 실패했습니다.');
  } finally {
    db.close();
  }
  const store = new SqliteProjectStore<Project>(filename, true);
  try {
    const projects = store.load(),
      tombstones = store.tombstones();
    for (const [id, version] of tombstones)
      if (!uuid.test(id) || !Number.isSafeInteger(version) || version < 1)
        throw new Error('삭제 프로젝트 표식이 올바르지 않습니다.');
    const summaries: ProjectSummary[] = projects
      .map((p) => {
        if (
          !uuid.test(p.id) ||
          !Number.isSafeInteger(p.revision) ||
          p.revision < 1 ||
          typeof p.name !== 'string' ||
          !Array.isArray(p.members) ||
          !Array.isArray(p.applied)
        )
          throw new Error('백업 프로젝트 메타데이터가 올바르지 않습니다.');
        checkSnapshot(p.files);
        if (
          p.lifecycle &&
          (!['active', 'trashing', 'trashed', 'restoring', 'purging'].includes(
            p.lifecycle.status,
          ) ||
            !Number.isSafeInteger(p.lifecycle.version) ||
            !uuid.test(p.lifecycle.trashId))
        )
          throw new Error('백업 프로젝트 수명이 올바르지 않습니다.');
        const lifecycle = p.lifecycle
          ? {
              status: p.lifecycle.status,
              version: p.lifecycle.version,
              trashId: p.lifecycle.trashId,
              identity: p.lifecycle.identity,
            }
          : { status: 'active', version: 0 };
        return { id: p.id, revision: p.revision, lifecycle };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
    return {
      schemaVersion,
      summaries,
      tombstones: [...tombstones].sort(([a], [b]) => a.localeCompare(b)),
      projects,
    };
  } finally {
    store.close();
  }
}

/** DB is authoritative. Older exports may exist; newer/foreign exports must not. */
export async function verifyRecoveryTree(
  root: string,
  data: ReturnType<typeof inspectDatabase>,
  files: { path: string }[],
  directories: string[],
) {
  const projects = new Map(data.projects.map((p) => [p.id, p])),
    tombstones = new Map(data.tombstones);
  const retained = new Map(
    data.projects
      .filter((p) => p.lifecycle)
      .map((p) => [p.lifecycle!.trashId, p]),
  );
  const checkpoints = new Map<string, Project>();
  for (const relative of directories) {
    const parts = relative.split('/');
    if (
      uuid.test(parts[0]) &&
      !projects.has(parts[0]) &&
      !tombstones.has(parts[0])
    )
      throw new Error('DB에 없는 프로젝트 폴더입니다.');
    if (parts[0] === '.project-trash' && parts[1] && !retained.has(parts[1]))
      throw new Error('DB에 없는 휴지통 폴더입니다.');
  }
  for (const file of files) {
    const parts = file.path.split('/');
    const sub = parts.slice(parts[0] === '.project-trash' ? 3 : 1);
    const p =
      parts[0] === '.project-trash'
        ? retained.get(parts[1])
        : projects.get(parts[0]);
    if (parts[0] === '.project-lifecycle') {
      const id = parts[1].slice(0, -5),
        marker = JSON.parse(
          await fs.readFile(path.join(root, ...parts), 'utf8'),
        );
      if (
        (!projects.has(id) && !tombstones.has(id)) ||
        ![
          'active',
          'trashing',
          'trashed',
          'restoring',
          'purging',
          'purged',
        ].includes(marker.status) ||
        !Number.isSafeInteger(marker.version)
      )
        throw new Error('수명 복구 표식이 올바르지 않습니다.');
    } else if (
      p &&
      sub.length === 3 &&
      sub[0] === 'checkpoints' &&
      sub[2] === 'state.json'
    ) {
      const saved = JSON.parse(
        await fs.readFile(path.join(root, ...parts), 'utf8'),
      );
      if (
        saved.id !== p.id ||
        !Number.isSafeInteger(saved.revision) ||
        saved.revision > p.revision
      )
        throw new Error('체크포인트 프로젝트 또는 revision이 DB와 다릅니다.');
      checkSnapshot(saved.files);
      checkpoints.set(file.path.slice(0, -'state.json'.length), saved);
    } else if (p && sub.length === 1 && sub[0] === 'head.json') {
      const head = JSON.parse(
        await fs.readFile(path.join(root, ...parts), 'utf8'),
      );
      if (!uuid.test(head.checkpoint))
        throw new Error('체크포인트 head가 올바르지 않습니다.');
      const state =
        file.path.slice(0, -'head.json'.length) +
        `checkpoints/${head.checkpoint}/state.json`;
      if (!files.some((f) => f.path === state))
        throw new Error('체크포인트 head의 자료가 누락되었습니다.');
    }
  }
  for (const file of files) {
    const match =
      /^((?:[a-f0-9-]{36}|\.project-trash\/[a-f0-9-]{36}\/project)\/checkpoints\/[a-f0-9-]{36}\/)files\/(.+)$/.exec(
        file.path,
      );
    if (!match) continue;
    const saved = checkpoints.get(match[1]);
    if (!saved || !Object.hasOwn(saved.files, match[2]))
      throw new Error('체크포인트에 등록되지 않은 파일은 백업하지 않습니다.');
    const actual = await fs.readFile(path.join(root, ...file.path.split('/')));
    const expected = createHash('sha256')
      .update(
        isAssetPath(match[2])
          ? decodeAsset(match[2], saved.files[match[2]])
          : saved.files[match[2]],
      )
      .digest('hex');
    if (createHash('sha256').update(actual).digest('hex') !== expected)
      throw new Error('체크포인트 파일과 상태 사본이 다릅니다.');
  }
  const captured = new Set(files.map((file) => file.path));
  for (const [prefix, saved] of checkpoints) {
    for (const relative of Object.keys(saved.files)) {
      if (!captured.has(prefix + 'files/' + relative))
        throw new Error('체크포인트 상태 사본의 파일이 누락되었습니다.');
    }
  }
}

export async function verifySourceLifecycles(
  root: string,
  data: ReturnType<typeof inspectDatabase>,
) {
  for (const p of data.projects) {
    const lifecycle = p.lifecycle;
    if (!lifecycle || lifecycle.status === 'active') continue;
    const live = await statDirectory(path.join(root, p.id));
    const trash = await statDirectory(
      path.join(root, '.project-trash', lifecycle.trashId, 'project'),
    );
    if (live && trash) throw new Error('원본과 휴지통 폴더가 동시에 있습니다.');
    const actual =
      lifecycle.status === 'trashed' || lifecycle.status === 'purging'
        ? trash
        : (live ?? trash);
    if (
      !(lifecycle.status === 'purging' && !actual) &&
      actual !== lifecycle.identity
    )
      throw new Error(
        '수명 폴더 식별자가 바뀌었습니다. 원본을 보존하고 확인해주세요.',
      );
  }
}
