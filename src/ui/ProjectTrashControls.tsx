import { useRuntime } from './runtime/RuntimeProvider';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  ProjectEntry,
  ProjectTrashEntry,
  SharedProjectLifecycle,
} from '../shared';
import { projectStorageKey } from '../project-trash-keys';
import type { FileTrashEntry } from '../contracts/file-trash';
const message = (e: unknown) =>
  e instanceof Error
    ? e.message.replace(/^Error invoking remote method '[^']+': /, '')
    : String(e);
const date = (time?: number) =>
  time ? new Date(time).toLocaleString('ko-KR') : '처리 중';
const stageLabel = {
  moving: '이동 중',
  retained: '보관 중',
  restoring: '복원 중',
  purging: '영구 삭제 중',
};
function TrashModal({
  title,
  busy,
  close,
  children,
}: {
  title: string;
  busy: boolean;
  close(): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <div
        ref={ref}
        className="modal-card project-trash-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) {
            e.preventDefault();
            close();
          }
          if (e.key === 'Tab') {
            const items = [
              ...(ref.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),select:not(:disabled)',
              ) ?? []),
            ];
            if (e.shiftKey && document.activeElement === items[0]) {
              e.preventDefault();
              items.at(-1)?.focus();
            } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
              e.preventDefault();
              items[0]?.focus();
            }
          }
        }}
      >
        <header>
          <h2>{title}</h2>
          <button disabled={busy} onClick={close}>
            닫기
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
export function ProjectTrashDialog({
  project,
  team,
  close,
  changed,
}: {
  project: ProjectEntry;
  team: boolean;
  close(): void;
  changed(): Promise<void>;
}) {
  const { api, preferences } = useRuntime();

  const [plan, setPlan] =
    useState<Awaited<ReturnType<typeof api.projects.prepareProjectTrash>>>();
  const [version, setVersion] = useState<number>();
  const [name, setName] = useState(''),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const request = team
      ? api.projects.getSharedProjectLifecycle(project.id).then((r) => {
          if (alive) {
            if (r.status !== 'active')
              throw Error(
                '프로젝트가 이미 삭제되었습니다. 휴지통에서 확인해주세요.',
              );
            setVersion(r.version);
          }
        })
      : api.projects.prepareProjectTrash(project.id).then((p) => {
          if (alive) setPlan(p);
        });
    void request.catch((e) => {
      if (alive) setError(message(e));
    });
    return () => {
      alive = false;
    };
  }, [project.id, team]);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (team)
        await api.projects.trashSharedProject(
          project.id,
          name,
          confirm,
          version!,
        );
      else {
        const values: Record<string, string> = {};
        const identities = [
          project.id,
          plan!.entry.root,
          project.projectId ?? '',
          `local:${plan!.entry.root}`,
          `shared:${project.projectId}`,
        ].filter(Boolean);
        for (let i = 0; i < preferences.length; i++) {
          const key = preferences.key(i)!;
          if (projectStorageKey(key, identities))
            values[key] = preferences.getItem(key)!;
        }
        await api.projects.trashProject(plan!.token, values);
        for (const key of Object.keys(values)) preferences.removeItem(key);
      }
      await changed();
      close();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <TrashModal
      title={team ? '공동 프로젝트 삭제 — 팀 전체' : '휴지통으로 이동'}
      busy={busy}
      close={close}
    >
      <h3>{project.name}</h3>
      <p className="project-trash-path">
        {team ? project.serverUrl : (plan?.entry.root ?? '저장 위치 확인 중…')}
      </p>
      <p>
        {team
          ? '서버 원본을 휴지통에 보관하고 모든 팀원의 서버 접근과 동기화를 중단합니다. 팀원 PC의 사본과 미반영 작업은 각 PC에 유지됩니다.'
          : project.kind === 'shared'
            ? '이 PC의 사본과 접속 정보를 보관합니다. 서버 원본과 다른 팀원의 자료는 유지됩니다.'
            : '이 프로젝트 폴더 안의 모든 파일과 식별 가능한 미반영 작업을 함께 보관합니다.'}
      </p>
      <p>
        7일 동안 복원할 수 있습니다.{' '}
        {team
          ? '외부 운영 서버는 자체 보관 정책에 따라 만료된 자료를 정리합니다.'
          : '앱이 꺼져 있으면 다음 실행 시 영구 삭제됩니다.'}{' '}
        기존 웹 뷰어 게시본은 남습니다.
      </p>
      {plan?.missing && (
        <p>폴더는 이미 없습니다. 남은 등록과 관련 자료를 보관합니다.</p>
      )}
      {team && (
        <>
          <label>
            프로젝트 이름을 입력해주세요
            <input
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="project-trash-check">
            <input
              type="checkbox"
              checked={confirm}
              disabled={busy}
              onChange={(e) => setConfirm(e.target.checked)}
            />
            모든 팀원의 서버 접근 중단을 확인했습니다.
          </label>
        </>
      )}
      {error && (
        <p className="home-error" role="alert">
          {error}
        </p>
      )}
      <div className="home-dialog-actions">
        <button disabled={busy} onClick={close}>
          취소
        </button>
        <button
          className="button-danger"
          disabled={
            busy ||
            (team
              ? version === undefined || name !== project.name || !confirm
              : !plan)
          }
          onClick={() => void submit()}
        >
          {busy
            ? '처리 중…'
            : team
              ? '팀 프로젝트 휴지통으로 이동'
              : '휴지통으로 이동'}
        </button>
      </div>
    </TrashModal>
  );
}
export function ProjectTrashPanel({
  initialServerProject,
  projects,
  close,
  changed,
}: {
  initialServerProject?: string;
  projects: ProjectEntry[];
  close(): void;
  changed(): Promise<void>;
}) {
  const { api, preferences, capabilities } = useRuntime();
  const retired = !capabilities.projectCollaboration;
  const [serverProject, setServerProject] = useState(
    initialServerProject ?? '',
  );

  const [items, setItems] = useState<ProjectTrashEntry[]>([]),
    [remote, setRemote] = useState<
      { entry: ProjectEntry; state: SharedProjectLifecycle }[]
    >([]);
  const [tab, setTab] = useState<'projects' | 'files'>('projects');
  const [files, setFiles] = useState<FileTrashEntry[]>();
  const [removeFile, setRemoveFile] = useState<FileTrashEntry>();
  const [fileError, setFileError] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [purge, setPurge] = useState<{
      id: string;
      name: string;
      team: boolean;
      version?: number;
      move?: boolean;
    }>();
  const [name, setName] = useState(''),
    [discard, setDiscard] = useState(false);
  const refresh = async () => {
    setFileError('');
    const fileList = api.projects
      .listFileTrash()
      .then(setFiles, (error) => setFileError(message(error)));
    setItems(await api.projects.listProjectTrash());
    if (retired) {
      await fileList;
      return;
    }
    const results = await Promise.allSettled(
      projects
        .filter((p) => p.kind === 'shared' && p.role === 'admin')
        .map(async (entry) => ({
          entry,
          state: await api.projects.getSharedProjectLifecycle(entry.id),
        })),
    );
    setRemote(
      results.flatMap((r) =>
        r.status === 'fulfilled' && r.value.state.status !== 'active'
          ? [r.value]
          : [],
      ),
    );
    if (results.some((r) => r.status === 'rejected'))
      setError(
        '일부 서버의 휴지통 상태를 확인하지 못했습니다. 서버 연결·버전을 확인해주세요.',
      );
    await fileList;
  };
  useEffect(() => {
    void refresh().catch((e) => setError(message(e)));
  }, []);
  const run = async (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await operation();
      await changed();
      await refresh();
      setPurge(undefined);
      setRemoveFile(undefined);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const readServer = async (id: string) => {
    const entry = projects.find((p) => p.id === id && p.kind === 'shared');
    if (!entry) return;
    setRemote([]);
    const state = await api.projects.getSharedProjectLifecycle(id);
    setRemote([{ entry, state }]);
  };
  useEffect(() => {
    if (retired && initialServerProject)
      void run(() => readServer(initialServerProject));
  }, [initialServerProject]);
  const updateServer = async (
    id: string,
    operation: () => Promise<SharedProjectLifecycle>,
  ) => {
    const state = await operation();
    setRemote((entries) =>
      entries.map(({ entry, state: previous }) => ({
        entry,
        state: entry.id === id ? state : previous,
      })),
    );
  };
  const restore = async (id: string) => {
    const values = await api.projects.restoreProjectTrash(id);
    for (const [key, value] of Object.entries(values))
      preferences.setItem(key, value);
    await api.projects.acknowledgeProjectRestore(id);
  };
  return (
    <TrashModal title="휴지통" busy={busy} close={close}>
      <div className="project-trash-tabs" role="group" aria-label="휴지통 종류">
        <button
          type="button"
          aria-pressed={tab === 'projects'}
          disabled={busy}
          onClick={() => setTab('projects')}
        >
          프로젝트
        </button>
        <button
          type="button"
          aria-pressed={tab === 'files'}
          disabled={busy}
          onClick={() => setTab('files')}
        >
          파일
        </button>
      </div>
      {tab === 'projects' ? (
        <>
          <p>
            7일 보관 후 영구 삭제됩니다. 보관 중에는 디스크 공간을 계속
            사용합니다.
          </p>
          <button
            disabled={busy}
            onClick={() => void run(() => api.projects.retryProjectTrash())}
          >
            상태 새로고침 · 정리 재시도
          </button>
          <div className="project-trash-list">
            <h3>이 PC</h3>
            {!items.length && <p>휴지통이 비어 있습니다.</p>}
            {items.map((item) => (
              <article key={item.trashId}>
                <strong>{item.name}</strong>
                <p>
                  {item.kind === 'shared'
                    ? '공동 프로젝트 사본'
                    : '로컬 프로젝트'}{' '}
                  · {stageLabel[item.stage]}
                </p>
                <p className="project-trash-path">{item.originalPath}</p>
                <p>영구 삭제 예정: {date(item.expiresAt)}</p>
                {item.error && <p role="alert">{item.error}</p>}
                <div className="home-dialog-actions">
                  <button
                    disabled={
                      busy ||
                      (item.stage !== 'restoring' &&
                        (item.stage !== 'retained' ||
                          item.expiresAt! <= Date.now()))
                    }
                    onClick={() => void run(() => restore(item.trashId))}
                  >
                    복원
                  </button>
                  <button
                    className="button-danger"
                    disabled={
                      busy || !['retained', 'purging'].includes(item.stage)
                    }
                    onClick={() => {
                      setPurge({
                        id: item.trashId,
                        name: item.name,
                        team: false,
                      });
                      setName('');
                      setDiscard(false);
                    }}
                  >
                    지금 영구 삭제…
                  </button>
                </div>
              </article>
            ))}
            <h3>서버 — 관리자</h3>
            {retired ? (
              <>
                <label>
                  관리할 공유 프로젝트
                  <select
                    value={serverProject}
                    disabled={busy}
                    onChange={(event) => {
                      setServerProject(event.target.value);
                      setRemote([]);
                      setPurge(undefined);
                      setError('');
                    }}
                  >
                    <option value="">프로젝트 선택</option>
                    {projects
                      .filter((entry) => entry.kind === 'shared')
                      .map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name} · {entry.serverUrl}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  disabled={busy || !serverProject}
                  onClick={() => void run(() => readServer(serverProject))}
                >
                  서버 상태 확인
                </button>
              </>
            ) : (
              !remote.length && <p>보관 중인 서버 프로젝트가 없습니다.</p>
            )}
            {remote.map(({ entry, state }) => (
              <article key={entry.id}>
                <strong>{state.name ?? entry.name}</strong>
                <p>
                  {entry.serverUrl} ·{' '}
                  {state.status === 'purged'
                    ? '영구 삭제됨'
                    : state.status === 'active'
                      ? '사용 중'
                      : '팀 전체 접근 중단'}
                </p>
                {state.expiresAt && <p>보관 기한 {date(state.expiresAt)}</p>}
                {state.error && <p role="alert">{state.error}</p>}
                <div className="home-dialog-actions">
                  <button
                    disabled={
                      busy ||
                      !['trashed', 'restoring'].includes(state.status) ||
                      (state.status !== 'restoring' &&
                        state.expiresAt! <= Date.now())
                    }
                    onClick={() =>
                      void run(() =>
                        updateServer(entry.id, () =>
                          api.projects.restoreSharedProject(
                            entry.id,
                            state.version,
                          ),
                        ),
                      )
                    }
                  >
                    팀 프로젝트 복원
                  </button>
                  <button
                    className="button-danger"
                    disabled={
                      busy || ['purged', 'restoring'].includes(state.status)
                    }
                    onClick={() => {
                      setPurge({
                        id: entry.id,
                        name: state.name ?? entry.name,
                        team: true,
                        version: state.version,
                        move: state.status === 'active',
                      });
                      setName('');
                      setDiscard(false);
                    }}
                  >
                    {state.status === 'active'
                      ? '서버 원본을 휴지통으로 이동…'
                      : '서버 원본 영구 삭제…'}
                  </button>
                </div>
              </article>
            ))}
          </div>
          {purge && (
            <section className="project-trash-confirm">
              <h3>
                “{purge.name}”{' '}
                {purge.move ? '서버 휴지통으로 이동' : '영구 삭제'}
              </h3>
              <p>
                {purge.move
                  ? '모든 팀원의 서버 접근이 중단됩니다. 서버 휴지통에서 7일 동안 복원할 수 있습니다.'
                  : purge.team
                    ? '서버 자료는 복원할 수 없습니다. 팀원 PC의 사본은 유지됩니다.'
                    : '미반영 작업을 포함한 보관 자료를 복구할 수 없습니다.'}
              </p>
              <label>
                프로젝트 이름
                <input
                  value={name}
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="project-trash-check">
                <input
                  type="checkbox"
                  checked={discard}
                  disabled={busy}
                  onChange={(e) => setDiscard(e.target.checked)}
                />
                {purge.move
                  ? '모든 팀원의 서버 접근 중단을 확인했습니다.'
                  : '영구 삭제와 복구 불가를 확인했습니다.'}
              </label>
              <div className="home-dialog-actions">
                <button disabled={busy} onClick={() => setPurge(undefined)}>
                  취소
                </button>
                <button
                  className="button-danger"
                  disabled={busy || name !== purge.name || !discard}
                  onClick={() =>
                    void run(() =>
                      purge.team
                        ? updateServer(purge.id, () =>
                            purge.move
                              ? api.projects.trashSharedProject(
                                  purge.id,
                                  name,
                                  discard,
                                  purge.version!,
                                )
                              : api.projects.purgeSharedProject(
                                  purge.id,
                                  name,
                                  discard,
                                  purge.version,
                                ),
                          )
                        : api.projects.purgeProjectTrash(
                            purge.id,
                            name,
                            discard,
                          ),
                    )
                  }
                >
                  {purge.move ? '휴지통으로 이동' : '영구 삭제'}
                </button>
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          <p>로컬 프로젝트에서 삭제한 파일을 7일 동안 복원할 수 있습니다.</p>
          <div className="project-trash-list" aria-label="파일 휴지통">
            {!fileError &&
              (!files ? (
                <p role="status">파일 휴지통을 불러오는 중…</p>
              ) : (
                !files.length && <p>보관 중인 파일이 없습니다.</p>
              ))}
            {files?.map((item) => (
              <article key={item.id}>
                <strong>{item.projectName}</strong>
                <ul>
                  {item.files.map((file) => (
                    <li key={file.path}>
                      {file.name}{' '}
                      <span className="project-trash-path">{file.path}</span>
                    </li>
                  ))}
                </ul>
                <p>보관 기한 {date(item.expiresAt)}</p>
                <div className="home-dialog-actions">
                  <button
                    disabled={busy || item.expiresAt <= Date.now()}
                    onClick={() =>
                      void run(() =>
                        api.projects.restoreFileTrash(item.projectId, item.id),
                      )
                    }
                  >
                    복원
                  </button>
                  <button
                    className="button-danger"
                    disabled={busy}
                    onClick={() => setRemoveFile(item)}
                  >
                    휴지통에서 제거…
                  </button>
                </div>
              </article>
            ))}
          </div>
          {fileError && (
            <p className="home-error" role="alert">
              {fileError}
            </p>
          )}
          {removeFile && (
            <section className="project-trash-confirm">
              <h3>“{removeFile.files[0].name}” 휴지통에서 제거</h3>
              <p>
                휴지통의 복원 사본을 지웁니다. 기존 편집 기록은 프로젝트에
                보관됩니다.
              </p>
              <div className="home-dialog-actions">
                <button
                  disabled={busy}
                  onClick={() => setRemoveFile(undefined)}
                >
                  취소
                </button>
                <button
                  className="button-danger"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      api.projects.purgeFileTrash(
                        removeFile.projectId,
                        removeFile.id,
                        true,
                      ),
                    )
                  }
                >
                  제거
                </button>
              </div>
            </section>
          )}
        </>
      )}
      {error && (
        <p className="home-error" role="alert">
          {error}
        </p>
      )}
    </TrashModal>
  );
}
