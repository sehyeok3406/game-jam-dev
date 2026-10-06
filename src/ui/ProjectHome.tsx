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
  Folder,
  MoreHorizontal,
  LayoutGrid,
  List,
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
} from 'lucide-react';
import type { ProjectEntry, ProjectFolder } from '../shared';
import { ROLE_NAMES } from './CollaborationPanel';
import {
  DEFAULT_HOME_VIEW,
  HOME_VIEW_KEY,
  readHomeView,
  selectHomeProjects,
  homeDate,
  homeDateLabel,
  type HomeView,
} from '../home-view';
import {
  HomeContextMenu,
  HomeOrganizationDialog,
  type HomeDialog,
} from './HomeOrganizationControls';

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
  const [folders, setFolders] = useState<ProjectFolder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [organizationDialog, setOrganizationDialog] =
    useState<HomeDialog | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    origin: HTMLElement;
    project?: ProjectEntry;
    folder?: ProjectFolder;
  } | null>(null);
  const [viewSettings, setViewSettings] = useState<HomeView>(() => {
    try {
      return readHomeView(localStorage.getItem(HOME_VIEW_KEY));
    } catch {
      return { ...DEFAULT_HOME_VIEW };
    }
  });
  const filter = viewSettings.filter;
  const setFilter = (value: HomeView['filter']) =>
    setViewSettings((previous) => ({ ...previous, filter: value }));
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
    try {
      localStorage.setItem(HOME_VIEW_KEY, JSON.stringify(viewSettings));
    } catch {
      setError(
        '보기 설정을 저장하지 못했습니다. 현재 보기는 적용되지만 다음 실행에서 초기화될 수 있습니다.',
      );
    }
  }, [viewSettings]);
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
  const refresh = async (refreshShared = false) => {
    try {
      const [entries, groups] = await Promise.all([
        window.gameCanvas.listProjects(refreshShared),
        window.gameCanvas.listProjectFolders(),
      ]);
      setProjects(entries);
      setFolders(groups);
      setSelectedFolder((id) =>
        groups.some((folder) => folder.id === id) ? id : null,
      );
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
  const visible = selectHomeProjects(
    projects,
    viewSettings,
    query,
    selectedFolder,
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
            aria-pressed={!selectedFolder && filter === item.id}
            onClick={() => {
              setFilter(item.id);
              setSelectedFolder(null);
            }}
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
        <div className="home-folders-heading">
          <span>폴더</span>
          <button
            aria-label="새 홈 폴더 만들기"
            title="새 홈 폴더"
            disabled={busy}
            onClick={() => {
              setError('');
              setOrganizationDialog({ type: 'create-folder' });
            }}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="home-folders-list">
          {folders.map((folder) => (
            <div
              className="home-folder-row"
              key={folder.id}
              onContextMenu={(event) => {
                event.preventDefault();
                if (!busy)
                  setMenu({
                    folder,
                    x: event.clientX,
                    y: event.clientY,
                    origin: event.currentTarget.querySelector('button')!,
                  });
              }}
            >
              <button
                className="home-nav"
                aria-pressed={selectedFolder === folder.id}
                onClick={() => {
                  setSelectedFolder(folder.id);
                  setFilter('all');
                }}
              >
                <Folder size={17} />
                <strong title={folder.name}>{folder.name}</strong>
                <span>
                  {
                    projects.filter((entry) => entry.folderId === folder.id)
                      .length
                  }
                </span>
              </button>
              <button
                className="home-folder-more"
                aria-label={`${folder.name} 폴더 메뉴`}
                aria-haspopup="menu"
                disabled={busy}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenu({
                    folder,
                    x: rect.right,
                    y: rect.bottom,
                    origin: event.currentTarget,
                  });
                }}
              >
                <MoreHorizontal size={16} />
              </button>
            </div>
          ))}
          {!folders.length && (
            <p className="home-folders-hint">폴더로 프로젝트를 정리하세요.</p>
          )}
        </div>
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
            onClick={() => void action(() => refresh(true))}
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
            {selectedFolder
              ? folders.find((folder) => folder.id === selectedFolder)?.name
              : filter === 'all'
                ? '최근 프로젝트'
                : filter === 'local'
                  ? '로컬 프로젝트'
                  : '공동 프로젝트'}
          </h2>
          <div className="home-list-controls">
            <label className="home-search">
              <Search size={16} />
              <input
                aria-label="프로젝트 검색"
                placeholder="프로젝트 검색"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <select
              aria-label="프로젝트 유형 필터"
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value as HomeView['filter'])
              }
            >
              <option value="all">모든 유형</option>
              <option value="local">로컬 프로젝트</option>
              <option value="shared">공동 프로젝트</option>
            </select>
            <select
              aria-label="프로젝트 정렬 기준"
              value={viewSettings.sortBy}
              onChange={(event) =>
                setViewSettings((previous) => ({
                  ...previous,
                  sortBy: event.target.value as HomeView['sortBy'],
                }))
              }
            >
              <option value="name">이름</option>
              <option value="created">생성일</option>
              <option value="modified">마지막으로 수정됨</option>
              <option value="opened">최근 열기</option>
            </select>
            <button
              className="home-sort-direction"
              title={
                viewSettings.sortBy === 'name'
                  ? viewSettings.direction === 'asc'
                    ? '가나다순 · 역순으로 변경'
                    : '역순 · 가나다순으로 변경'
                  : viewSettings.direction === 'desc'
                    ? '최신순 · 오래된 순으로 변경'
                    : '오래된 순 · 최신순으로 변경'
              }
              aria-label={
                viewSettings.sortBy === 'name'
                  ? viewSettings.direction === 'asc'
                    ? '이름 가나다순, 역순으로 변경'
                    : '이름 역순, 가나다순으로 변경'
                  : viewSettings.direction === 'desc'
                    ? '최신순, 오래된 순으로 변경'
                    : '오래된 순, 최신순으로 변경'
              }
              onClick={() =>
                setViewSettings((previous) => ({
                  ...previous,
                  direction: previous.direction === 'asc' ? 'desc' : 'asc',
                }))
              }
            >
              {viewSettings.direction === 'desc' ? (
                <ArrowDownWideNarrow size={16} />
              ) : (
                <ArrowUpWideNarrow size={16} />
              )}
            </button>
            <div
              className="home-view-toggle"
              role="group"
              aria-label="프로젝트 보기 방식"
            >
              <button
                title="썸네일 보기"
                aria-label="썸네일 보기"
                aria-pressed={viewSettings.view === 'grid'}
                onClick={() =>
                  setViewSettings((previous) => ({ ...previous, view: 'grid' }))
                }
              >
                <LayoutGrid size={16} />
              </button>
              <button
                title="목록 보기"
                aria-label="목록 보기"
                aria-pressed={viewSettings.view === 'list'}
                onClick={() =>
                  setViewSettings((previous) => ({ ...previous, view: 'list' }))
                }
              >
                <List size={16} />
              </button>
            </div>
          </div>
        </div>
        {!loading && (
          <p className="home-result-count" role="status">
            {visible.length}개 프로젝트 ·{' '}
            {viewSettings.sortBy === 'name'
              ? '이름'
              : homeDateLabel(viewSettings.sortBy)}{' '}
            {viewSettings.sortBy === 'name'
              ? viewSettings.direction === 'asc'
                ? '가나다순'
                : '역순'
              : viewSettings.direction === 'desc'
                ? '최신순'
                : '오래된 순'}
          </p>
        )}
        {error && (
          <p className="home-error" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status">프로젝트 불러오는 중…</p>
        ) : (
          <div
            className={`home-project-grid${viewSettings.view === 'list' ? ' home-project-list' : ''}`}
          >
            {visible.map((entry) => (
              <article
                className="home-project-card"
                key={entry.id}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (!busy)
                    setMenu({
                      project: entry,
                      x: event.clientX,
                      y: event.clientY,
                      origin: event.currentTarget.querySelector('button')!,
                    });
                }}
              >
                <button
                  className="home-project-more"
                  disabled={busy}
                  aria-label={`${entry.name} 프로젝트 메뉴`}
                  aria-haspopup="menu"
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setMenu({
                      project: entry,
                      x: rect.left,
                      y: rect.bottom,
                      origin: event.currentTarget,
                    });
                  }}
                >
                  <MoreHorizontal size={17} />
                </button>
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
                    <div className="home-mini-canvas" aria-hidden="true">
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
                    {entry.folderId && (
                      <p className="home-project-folder">
                        <Folder size={12} />
                        {
                          folders.find((folder) => folder.id === entry.folderId)
                            ?.name
                        }
                      </p>
                    )}
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
                      <time
                        title={`${homeDateLabel(viewSettings.sortBy)}${entry.kind === 'shared' ? ' · 마지막 서버 확인 기준' : ''}`}
                        dateTime={
                          homeDate(entry, viewSettings.sortBy)
                            ? new Date(
                                homeDate(entry, viewSettings.sortBy)!,
                              ).toISOString()
                            : undefined
                        }
                      >
                        {homeDate(entry, viewSettings.sortBy)
                          ? new Date(
                              homeDate(entry, viewSettings.sortBy)!,
                            ).toLocaleDateString('ko-KR')
                          : '날짜 정보 없음'}
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
              {selectedFolder && !query && filter === 'all'
                ? '이 폴더는 비어 있습니다.'
                : projects.length
                  ? '검색 결과가 없습니다.'
                  : '첫 게임 아이디어를 시작해보세요.'}
            </h3>
            <p>
              {selectedFolder && !query && filter === 'all'
                ? '프로젝트 메뉴에서 ‘폴더로 이동’을 선택해 분류하세요.'
                : projects.length
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
      {menu && (
        <HomeContextMenu
          x={menu.x}
          y={menu.y}
          origin={menu.origin}
          close={() => setMenu(null)}
          items={
            menu.project
              ? [
                  {
                    label: '열기',
                    action: () =>
                      void action(async () => {
                        await window.gameCanvas.openProject(menu.project!.id);
                        await opened();
                      }),
                  },
                  {
                    label: '이름 변경',
                    disabled:
                      menu.project.kind === 'shared' &&
                      menu.project.role !== 'admin',
                    title:
                      menu.project.kind === 'shared'
                        ? '공동 프로젝트 이름은 관리자만 온라인에서 변경할 수 있습니다.'
                        : undefined,
                    action: () => {
                      setError('');
                      setOrganizationDialog({
                        type: 'rename-project',
                        project: menu.project!,
                      });
                    },
                  },
                  {
                    label: '폴더로 이동',
                    action: () => {
                      setError('');
                      setOrganizationDialog({
                        type: 'move-project',
                        project: menu.project!,
                      });
                    },
                  },
                  menu.project.kind === 'local'
                    ? {
                        label: '저장 위치 보기',
                        action: () =>
                          void action(() =>
                            window.gameCanvas.revealProject(menu.project!.id),
                          ),
                      }
                    : {
                        label: '서버 주소 변경',
                        action: () => {
                          setError('');
                          setServer(menu.project!);
                          setAddress(menu.project!.serverUrl ?? '');
                        },
                      },
                ]
              : [
                  {
                    label: '열기',
                    action: () => {
                      setSelectedFolder(menu.folder!.id);
                      setFilter('all');
                    },
                  },
                  {
                    label: '이름 변경',
                    action: () => {
                      setError('');
                      setOrganizationDialog({
                        type: 'rename-folder',
                        folder: menu.folder!,
                      });
                    },
                  },
                  {
                    label: '폴더 삭제',
                    action: () => {
                      setError('');
                      setOrganizationDialog({
                        type: 'remove-folder',
                        folder: menu.folder!,
                      });
                    },
                  },
                ]
          }
        />
      )}
      {organizationDialog && (
        <HomeOrganizationDialog
          dialog={organizationDialog}
          folders={folders}
          busy={busy}
          error={error}
          close={() => {
            setOrganizationDialog(null);
            setError('');
          }}
          submit={(value) =>
            void action(async () => {
              switch (organizationDialog.type) {
                case 'rename-project':
                  await window.gameCanvas.renameProject(
                    organizationDialog.project.id,
                    value,
                    organizationDialog.project.name,
                  );
                  break;
                case 'move-project':
                  await window.gameCanvas.moveProject(
                    organizationDialog.project.id,
                    value || null,
                  );
                  break;
                case 'create-folder':
                  await window.gameCanvas.createProjectFolder(value);
                  break;
                case 'rename-folder':
                  await window.gameCanvas.renameProjectFolder(
                    organizationDialog.folder.id,
                    value,
                  );
                  break;
                case 'remove-folder':
                  await window.gameCanvas.removeProjectFolder(
                    organizationDialog.folder.id,
                  );
                  break;
              }
              setOrganizationDialog(null);
              await refresh();
            })
          }
        />
      )}
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
