import { useRuntime } from './runtime/RuntimeProvider';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  ProjectEntry,
  ProjectTrashEntry,
  SharedProjectLifecycle,
} from '../shared';
import { projectStorageKey } from '../project-trash-keys';
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
                'button:not(:disabled),input:not(:disabled)',
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
          ? '서버가 꺼져 있으면 다음 서버 시작 시 영구 삭제됩니다.'
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
  projects,
  close,
  changed,
}: {
  projects: ProjectEntry[];
  close(): void;
  changed(): Promise<void>;
}) {
  const { api, preferences } = useRuntime();

  const [items, setItems] = useState<ProjectTrashEntry[]>([]),
    [remote, setRemote] = useState<
      { entry: ProjectEntry; state: SharedProjectLifecycle }[]
    >([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [purge, setPurge] = useState<{ id: string; name: string; team: boolean }>();
  const [name, setName] = useState(''),
    [discard, setDiscard] = useState(false);
  const refresh = async () => {
    setItems(await api.projects.listProjectTrash());
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
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const restore = async (id: string) => {
    const values = await api.projects.restoreProjectTrash(id);
    for (const [key, value] of Object.entries(values))
      preferences.setItem(key, value);
    await api.projects.acknowledgeProjectRestore(id);
  };
  return (
    <TrashModal title="프로젝트 휴지통" busy={busy} close={close}>
      <p>
        7일 보관 후 영구 삭제됩니다. 보관 중에는 디스크 공간을 계속 사용합니다.
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
              {item.kind === 'shared' ? '공동 프로젝트 사본' : '로컬 프로젝트'}{' '}
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
                disabled={busy || !['retained', 'purging'].includes(item.stage)}
                onClick={() => {
                  setPurge({ id: item.trashId, name: item.name, team: false });
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
        {!remote.length && <p>보관 중인 서버 프로젝트가 없습니다.</p>}
        {remote.map(({ entry, state }) => (
          <article key={entry.id}>
            <strong>{entry.name}</strong>
            <p>
              {entry.serverUrl} ·{' '}
              {state.status === 'purged' ? '영구 삭제됨' : '팀 전체 접근 중단'}
            </p>
            <p>영구 삭제 예정: {date(state.expiresAt)}</p>
            {state.error && <p role="alert">{state.error}</p>}
            <div className="home-dialog-actions">
              <button
                disabled={
                  busy ||
                  !['trashed', 'restoring'].includes(state.status) ||
                  state.expiresAt! <= Date.now()
                }
                onClick={() =>
                  void run(() => api.projects.restoreSharedProject(entry.id))
                }
              >
                팀 프로젝트 복원
              </button>
              <button
                className="button-danger"
                disabled={busy || state.status === 'purged'}
                onClick={() => {
                  setPurge({ id: entry.id, name: entry.name, team: true });
                  setName('');
                  setDiscard(false);
                }}
              >
                서버 원본 영구 삭제…
              </button>
            </div>
          </article>
        ))}
      </div>
      {purge && (
        <section className="project-trash-confirm">
          <h3>“{purge.name}” 영구 삭제</h3>
          <p>
            {purge.team
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
            영구 삭제와 복구 불가를 확인했습니다.
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
                    ? api.projects.purgeSharedProject(purge.id, name)
                    : api.projects.purgeProjectTrash(purge.id, name, discard),
                )
              }
            >
              영구 삭제
            </button>
          </div>
        </section>
      )}
      {error && (
        <p className="home-error" role="alert">
          {error}
        </p>
      )}
    </TrashModal>
  );
}
