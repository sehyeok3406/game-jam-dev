import { useEffect, useRef, useState } from 'react';
import {
  FolderOpen,
  Plus,
  Users,
  Search,
  Sun,
  Moon,
  ArrowRight,
  HardDrive,
  Wifi,
  Settings2,
  RefreshCw,
} from 'lucide-react';
import type { ProjectEntry } from '../shared';
import { ROLE_NAMES } from './CollaborationPanel';

export function ProjectHome({
  opened,
  join,
  recover,
  updates,
  toggleTheme,
  theme,
}: {
  opened: () => Promise<void>;
  join: () => void;
  recover: () => void;
  updates: () => void;
  toggleTheme: () => void;
  theme: 'dark' | 'light';
}) {
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [filter, setFilter] = useState<'all' | 'local' | 'shared'>('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [create, setCreate] = useState(false);
  const [name, setName] = useState('');
  const [server, setServer] = useState<ProjectEntry | null>(null);
  const [address, setAddress] = useState('');
  const dialogRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!create && !server) return;
    const previous = document.activeElement as HTMLElement | null;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        setCreate(false);
        setServer(null);
        setError('');
      }
      if (event.key !== 'Tab') return;
      const items = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          'input,button:not(:disabled)',
        ) ?? []),
      ];
      const first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      if (previous?.isConnected) previous.focus();
    };
  }, [create, server, busy]);
  const refresh = async () => {
    try {
      setProjects(await window.gameCanvas.listProjects());
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const action = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message.replace(/^Error invoking remote method '[^']+': /, '')
          : String(error),
      );
    } finally {
      setBusy(false);
    }
  };
  const visible = projects.filter(
    (entry) =>
      (filter === 'all' || entry.kind === filter) &&
      `${entry.name} ${entry.root ?? ''} ${entry.serverUrl ?? ''}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  return (
    <main className="project-home">
      <aside className="home-sidebar">
        <div className="home-brand">
          <span className="brand-mark">GC</span>
          <strong>Game Canvas</strong>
        </div>
        <p className="home-sidebar-caption">내 프로젝트</p>
        {(
          [
            { id: 'all', label: '최근 프로젝트', icon: FolderOpen },
            { id: 'local', label: '로컬 프로젝트', icon: HardDrive },
            { id: 'shared', label: '공동 프로젝트', icon: Users },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            className="home-nav"
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
          >
            <item.icon size={17} />
            {item.label}
            <span>
              {
                projects.filter(
                  (entry) => item.id === 'all' || entry.kind === item.id,
                ).length
              }
            </span>
          </button>
        ))}
        <div className="home-sidebar-bottom">
          <button onClick={updates}>
            <RefreshCw size={16} /> 앱 업데이트
          </button>
          <button onClick={toggleTheme}>
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            {theme === 'dark' ? '라이트 모드' : '다크 모드'}
          </button>
          <p>
            아이디어 → 문서 → 게임
            <br />이 PC에서 시작하는 프로토타입
          </p>
        </div>
      </aside>
      <section className="home-content">
        <header className="home-topbar">
          <span>워크스페이스</span>
          <button
            disabled={busy}
            onClick={() => void refresh()}
            title="프로젝트 목록 새로고침"
          >
            <RefreshCw size={15} />
          </button>
        </header>
        <div className="home-heading">
          <div>
            <p className="eyebrow">YOUR NEXT GAME STARTS HERE</p>
            <h1>프로젝트</h1>
            <p>
              작업할 캔버스를 선택하세요. 공동 프로젝트는 내 역할로 다시
              연결됩니다.
            </p>
          </div>
          <button
            className="button-primary"
            disabled={busy}
            onClick={() => {
              setName('');
              setCreate(true);
            }}
          >
            <Plus size={17} /> 새 프로젝트
          </button>
        </div>
        <div className="home-entry-actions">
          <button
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const state = await window.gameCanvas.selectWorkspace();
                if (state.root) await opened();
              })
            }
          >
            <FolderOpen size={19} />
            <span>
              <strong>기존 폴더 열기</strong>
              <small>이 PC의 Markdown 프로젝트</small>
            </span>
            <ArrowRight size={16} />
          </button>
          <button disabled={busy} onClick={join}>
            <Users size={19} />
            <span>
              <strong>초대 코드로 참여</strong>
              <small>서버 주소 · 초대 코드 · 닉네임</small>
            </span>
            <ArrowRight size={16} />
          </button>
        </div>
        <div className="home-list-toolbar">
          <h2>
            {filter === 'all'
              ? '최근 프로젝트'
              : filter === 'local'
                ? '로컬 프로젝트'
                : '공동 프로젝트'}
          </h2>
          <label className="home-search">
            <Search size={16} />
            <input
              aria-label="프로젝트 검색"
              placeholder="프로젝트 검색"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        {error && (
          <p className="home-error" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status">프로젝트 불러오는 중…</p>
        ) : (
          <div className="home-project-grid">
            {visible.map((entry) => (
              <article className="home-project-card" key={entry.id}>
                <button
                  className="home-project-open"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await window.gameCanvas.openProject(entry.id);
                      await opened();
                    })
                  }
                >
                  <div
                    className={`home-project-cover home-project-cover--${entry.kind}`}
                  >
                    <div className="home-mini-canvas">
                      <i />
                      <i />
                      <i />
                      <i />
                    </div>
                    <span>
                      {entry.kind === 'shared' ? (
                        <Users size={15} />
                      ) : (
                        <HardDrive size={15} />
                      )}
                      {entry.kind === 'shared' ? '공유 중' : '로컬'}
                    </span>
                  </div>
                  <div className="home-project-details">
                    <h3>{entry.name}</h3>
                    <p
                      className="home-project-location"
                      title={entry.root ?? entry.serverUrl}
                    >
                      {entry.root ?? entry.serverUrl}
                    </p>
                    <div className="home-project-meta">
                      <span>
                        {entry.kind === 'shared' ? (
                          <>
                            <Wifi size={13} />
                            {entry.role
                              ? ROLE_NAMES[entry.role]
                              : '저장된 세션'}{' '}
                            · {entry.connected ? '연결됨' : '열면 재연결'}
                          </>
                        ) : (
                          '이 PC에 저장'
                        )}
                      </span>
                      <time>
                        {new Date(entry.lastOpenedAt).toLocaleDateString(
                          'ko-KR',
                        )}
                      </time>
                    </div>
                    {!!entry.pendingChanges && (
                      <p className="home-pending">
                        동기화 대기 · {entry.pendingChanges}개 파일
                      </p>
                    )}
                  </div>
                </button>
                {entry.kind === 'shared' && (
                  <button
                    className="home-server-edit"
                    disabled={busy}
                    title={`${entry.name} 서버 주소 변경`}
                    onClick={() => {
                      setServer(entry);
                      setAddress(entry.serverUrl ?? '');
                    }}
                  >
                    <Settings2 size={14} /> 서버 주소
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
        {!loading && !visible.length && (
          <div className="home-empty">
            <FolderOpen size={34} />
            <h3>
              {projects.length
                ? '검색 결과가 없습니다.'
                : '첫 게임 아이디어를 시작해보세요.'}
            </h3>
            <p>
              {projects.length
                ? '검색어나 프로젝트 종류를 바꿔보세요.'
                : '새 프로젝트를 만들거나 기존 폴더를 열면 여기에 표시됩니다.'}
            </p>
          </div>
        )}
        <footer className="home-footer">
          관리자·참여자 세션은 이 PC에 안전하게 기억됩니다.{' '}
          <button onClick={recover} disabled={busy}>
            세션을 잃었나요? 관리자 복구
          </button>
        </footer>
      </section>
      {(create || server) && (
        <div className="modal-backdrop">
          <form
            ref={dialogRef}
            className="modal-card home-create-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="home-dialog-title"
            onSubmit={(event) => {
              event.preventDefault();
              void action(async () => {
                if (server) {
                  await window.gameCanvas.updateProjectServer(
                    server.id,
                    address,
                  );
                  setServer(null);
                  await refresh();
                } else {
                  const state = await window.gameCanvas.createProject(name);
                  if (state.root) {
                    setCreate(false);
                    await opened();
                  }
                }
              });
            }}
          >
            <h2 id="home-dialog-title">
              {server ? '공동 프로젝트 서버 주소' : '새 로컬 프로젝트'}
            </h2>
            <p>
              {server
                ? '터널 주소가 바뀌었다면 새 주소를 입력하세요. 내 역할과 작업 사본은 유지됩니다.'
                : '이름을 입력하고 저장할 상위 폴더를 선택하세요. 나중에 이 프로젝트를 공유할 수 있습니다.'}
            </p>
            <label>
              {server ? '서버 주소' : '프로젝트 이름'}
              <input
                autoFocus
                required
                maxLength={server ? 500 : 100}
                value={server ? address : name}
                onChange={(event) =>
                  server
                    ? setAddress(event.target.value)
                    : setName(event.target.value)
                }
              />
            </label>
            {error && (
              <p className="home-error" role="alert">
                {error}
              </p>
            )}
            <div className="home-dialog-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setCreate(false);
                  setServer(null);
                  setError('');
                }}
              >
                취소
              </button>
              <button className="button-primary" disabled={busy}>
                {busy ? '처리 중…' : server ? '주소 저장' : '저장 위치 선택'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
