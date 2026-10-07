import type { UpdateState } from './shared.ts';

export type ReleaseRepository = { owner: string; repository: string };
export function releaseRepository(value: ReleaseRepository) {
  if (!value.owner && !value.repository) return null;
  if (
    !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(value.owner) ||
    !/^[a-z\d_.-]{1,100}$/i.test(value.repository) ||
    ['.', '..'].includes(value.repository)
  )
    throw new Error('GitHub 저장소 소유자와 이름을 확인해주세요.');
  return `${value.owner}/${value.repository}`;
}

export function updateFeed(repository: string, arch: string, version: string) {
  if (
    !['x64', 'ia32', 'arm64'].includes(arch) ||
    !/^\d+\.\d+\.\d+(?:-[a-z\d.-]+)?$/i.test(version)
  )
    throw new Error('업데이트 플랫폼 또는 앱 버전이 올바르지 않습니다.');
  const [owner, name, extra] = repository.split('/');
  if (extra || !releaseRepository({ owner, repository: name ?? '' }))
    throw new Error('GitHub 저장소 형식이 올바르지 않습니다.');
  return `https://update.electronjs.org/${owner}/${name}/win32-${arch}/${version}`;
}

export type UpdateSafety = {
  aiBusy: boolean;
  pendingWrites: boolean;
  disconnected: boolean;
  hostingGuests: boolean;
  testWindows: boolean;
};
export function updateBlockers(safety: UpdateSafety) {
  return [
    safety.aiBusy &&
      'AI 작업이 진행 중입니다. 완료하거나 중지한 뒤 다시 시도해주세요.',
    safety.pendingWrites &&
      '파일 저장·동기화가 진행 중입니다. 잠시 기다려주세요.',
    safety.disconnected && '협업 서버에 재연결한 뒤 저장 상태를 확인해주세요.',
    safety.hostingGuests &&
      '내장 협업 서버에 다른 참여자가 있습니다. 함께 작업을 마친 뒤 업데이트해주세요. 재시작하면 서버도 중지됩니다.',
    safety.testWindows && '테스트 사용자 창을 먼저 닫아주세요.',
  ].filter((value): value is string => !!value);
}

type UpdatePort = {
  on: (name: string, listener: (...args: unknown[]) => void) => unknown;
  removeListener: (
    name: string,
    listener: (...args: unknown[]) => void,
  ) => unknown;
  setFeedURL: (options: { url: string }) => void;
  checkForUpdates: () => void;
  quitAndInstall: () => void;
};
type Options = {
  updater: UpdatePort;
  repository: ReleaseRepository;
  version: string;
  arch: string;
  available: boolean;
  unavailableReason: string;
  automatic: boolean;
  startupDelayMs?: number;
  persistAutomatic: (enabled: boolean) => Promise<void>;
  blockers: () => Promise<string[]>;
  prepareRestart: () => Promise<string[]>;
  releaseRestart: () => void;
  confirmRestart: () => Promise<boolean>;
  changed: (state: UpdateState) => void;
  log: (state: UpdateState) => void;
};

/** No network, timers or updater calls until a trusted build-time repository exists. */
export class AppUpdateController {
  private options: Options;
  private state: UpdateState;
  private listeners: [string, (...args: unknown[]) => void][] = [];
  private startup?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;
  private preferences = Promise.resolve();
  private installing = false;
  private started = false;
  constructor(options: Options) {
    this.options = options;
    let repository: string | null = null;
    let configError = '';
    try {
      repository = releaseRepository(options.repository);
    } catch (error) {
      configError = String(error);
    }
    this.state = {
      currentVersion: options.version,
      repository,
      automatic: options.automatic,
      status: configError
        ? 'error'
        : !repository
          ? 'unconfigured'
          : !options.available
            ? 'unavailable'
            : 'idle',
      available: !!repository && options.available && !configError,
      message:
        configError ||
        (!repository
          ? 'GitHub 배포 저장소 연결 대기 중입니다.'
          : !options.available
            ? options.unavailableReason
            : '새 버전을 확인할 수 있습니다.'),
      errorCode: configError ? 'GC-UPD-001' : undefined,
    };
    if (!this.state.available) return;
    try {
      options.updater.setFeedURL({
        url: updateFeed(repository!, options.arch, options.version),
      });
    } catch {
      this.patch({
        available: false,
        status: 'error',
        errorCode: 'GC-UPD-001',
        message: '업데이트 배포 설정을 확인해주세요.',
      });
      return;
    }
    this.listen('checking-for-update', () =>
      this.patch({
        status: 'checking',
        message: '새 버전을 확인하고 있습니다.',
      }),
    );
    this.listen('update-available', () =>
      this.patch({
        status: 'downloading',
        message: '새 버전을 다운로드하고 있습니다. 작업을 계속해도 됩니다.',
      }),
    );
    this.listen('update-not-available', () =>
      this.patch({
        status: 'current',
        lastCheckedAt: Date.now(),
        errorCode: undefined,
        message: '최신 버전입니다.',
      }),
    );
    this.listen('update-downloaded', (_event, _notes, releaseName) =>
      this.patch({
        status: 'ready',
        lastCheckedAt: Date.now(),
        errorCode: undefined,
        releaseName:
          typeof releaseName === 'string'
            ? releaseName.slice(0, 120)
            : undefined,
        message:
          '업데이트 다운로드 완료! 작업을 마친 뒤 재시작하면 적용됩니다.',
      }),
    );
    this.listen('error', () => {
      if (this.state.status === 'installing') {
        this.options.releaseRestart();
        this.patch({
          status: 'ready',
          errorCode: 'GC-UPD-005',
          message:
            '업데이트 설치에 실패했습니다. 저장 상태를 확인하고 다시 시도해주세요.',
        });
      } else
        this.patch({
          status: 'error',
          errorCode: 'GC-UPD-003',
          message:
            '업데이트 확인·다운로드에 실패했습니다. 인터넷 연결과 GitHub 릴리스의 업데이트 파일을 확인한 뒤 다시 시도해주세요.',
        });
    });
  }
  private listen(name: string, callback: (...args: unknown[]) => void) {
    this.options.updater.on(name, callback);
    this.listeners.push([name, callback]);
  }
  private patch(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch };
    this.options.changed(this.snapshot());
    this.options.log(this.snapshot());
  }
  snapshot(): UpdateState {
    return { ...this.state };
  }
  start() {
    if (this.started || !this.state.available) return;
    this.started = true;
    // Check once on every launch; the preference controls periodic checks.
    this.startup = setTimeout(() => {
      this.startup = undefined;
      this.check();
    }, this.options.startupDelayMs ?? 1_000);
    this.startup.unref?.();
    this.schedulePeriodicChecks();
  }
  private schedulePeriodicChecks() {
    clearInterval(this.interval);
    this.interval = undefined;
    if (!this.started || !this.state.available || !this.state.automatic) return;
    this.interval = setInterval(() => this.check(), 6 * 60 * 60 * 1000);
    this.interval.unref?.();
  }
  private stopTimers() {
    clearTimeout(this.startup);
    clearInterval(this.interval);
    this.startup = undefined;
    this.interval = undefined;
  }
  setAutomatic(enabled: boolean) {
    if (typeof enabled !== 'boolean')
      return Promise.reject(
        new Error('[GC-UPD-001] 설정 값이 올바르지 않습니다.'),
      );
    const save = this.preferences.then(async () => {
      try {
        await this.options.persistAutomatic(enabled);
      } catch {
        throw new Error('[GC-UPD-006] 업데이트 설정을 저장하지 못했습니다.');
      }
      this.patch({ automatic: enabled });
      this.schedulePeriodicChecks();
      return this.snapshot();
    });
    this.preferences = save.then(
      () => undefined,
      () => undefined,
    );
    return save;
  }
  check() {
    if (
      !this.state.available ||
      this.installing ||
      ['checking', 'downloading', 'ready', 'installing'].includes(
        this.state.status,
      )
    )
      return this.snapshot();
    this.patch({
      status: 'checking',
      lastCheckedAt: Date.now(),
      errorCode: undefined,
      message: '새 버전을 확인하고 있습니다.',
    });
    try {
      this.options.updater.checkForUpdates();
    } catch {
      this.patch({
        status: 'error',
        errorCode: 'GC-UPD-003',
        message:
          '업데이트 확인을 시작하지 못했습니다. 설치 상태와 네트워크를 확인하고 다시 시도해주세요.',
      });
    }
    return this.snapshot();
  }
  async install() {
    if (this.state.status !== 'ready' || this.installing)
      return this.snapshot();
    this.installing = true;
    let prepared = false;
    try {
      let blockers = await this.options.blockers();
      if (blockers.length) {
        this.patch({ errorCode: 'GC-UPD-004', message: blockers.join('\n') });
        return this.snapshot();
      }
      if (!(await this.options.confirmRestart())) return this.snapshot();
      prepared = true;
      blockers = await this.options.prepareRestart();
      // Recheck main-process operations after the renderer has stopped accepting input.
      blockers.push(...(await this.options.blockers()));
      if (blockers.length) {
        this.patch({
          errorCode: 'GC-UPD-004',
          message: [...new Set(blockers)].join('\n'),
        });
        return this.snapshot();
      }
      this.patch({
        status: 'installing',
        errorCode: undefined,
        message: '업데이트를 적용하고 재시작합니다.',
      });
      this.options.updater.quitAndInstall();
      return this.snapshot();
    } catch {
      this.patch({
        status: 'ready',
        errorCode: 'GC-UPD-005',
        message:
          '안전한 재시작을 완료하지 못했습니다. 저장 상태를 확인한 뒤 다시 시도해주세요.',
      });
      return this.snapshot();
    } finally {
      if (prepared && this.snapshot().status !== 'installing')
        this.options.releaseRestart();
      this.installing = false;
    }
  }
  dispose() {
    this.stopTimers();
    for (const [name, callback] of this.listeners)
      this.options.updater.removeListener(name, callback);
    this.listeners = [];
  }
}
