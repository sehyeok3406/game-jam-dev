import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { ProjectLibrary } from '../../project-library.ts';
import { connectionInfo } from '../../connection-info.ts';
import type { CollaborationCredentials } from '../../collaboration-client.ts';
import type { HostReport, SelfHostState } from './types.ts';

const execute = promisify(execFile);
type HostOptions = {
  directory: string;
  runtimeSource: string;
  library: ProjectLibrary;
  activeProject: () => string | undefined;
  changed: (state: SelfHostState) => void;
  appVersion: string;
  appPath: string;
  port?: number;
};
const messages: Record<string, string> = {
  'GC-HOST-002':
    '서버 실행 파일이 없습니다. 앱을 다시 설치하거나 업데이트하세요.',
  'GC-HOST-003':
    '앱에 포함된 서버 실행 도구를 찾지 못했습니다. 앱을 다시 설치하세요.',
  'GC-HOST-004':
    'Cloudflare 연결 도구가 필요합니다. 연결 도구 준비를 눌러주세요.',
  'GC-HOST-005':
    '저장된 실행 정보를 읽지 못했습니다. 데이터 폴더를 삭제하지 말고 AI 요청문으로 도움을 받으세요.',
  'GC-HOST-006':
    '다른 프로그램이 서버 포트를 사용하고 있습니다. 해당 프로그램을 확인하세요.',
  'GC-HOST-007':
    '프로세스 소유권을 확인하지 못했습니다. 서버를 시작한 Windows 계정으로 확인하세요.',
  'GC-HOST-008':
    '서버와 연결 도구 중 한쪽만 실행 중입니다. 작업을 마친 뒤 서버 끄기 후 다시 켜세요.',
  'GC-HOST-009':
    '이 PC의 서버가 응답하지 않습니다. 작업을 마친 뒤 명시적으로 재시작하세요.',
  'GC-HOST-010':
    '외부 연결을 확인하지 못했습니다. 인터넷을 확인하고 다시 확인을 누르세요.',
  'GC-HOST-011':
    '서버를 실행하지 못했습니다. 실행 권한과 백신 차단 여부를 확인하세요.',
  'GC-HOST-012':
    '연결 도구를 실행하지 못했습니다. 인터넷과 백신 차단 여부를 확인하세요.',
  'GC-HOST-013':
    '서버 키를 읽지 못했습니다. 기존 Windows 계정으로 실행하고 키 파일을 보존하세요.',
  'GC-HOST-014': '다른 창에서 서버 준비 중입니다. 완료 후 다시 확인하세요.',
  'GC-HOST-015':
    '설정을 저장하지 못했습니다. 데이터 폴더 권한과 디스크 공간을 확인하세요.',
  'GC-HOST-AI':
    '서버에서 AI 작업이 진행 중입니다. 작업을 완료하거나 앱에서 중지한 뒤 다시 시도하세요.',
  'GC-HOST-DOWNLOAD':
    '공식 연결 도구를 다운로드·검증하지 못했습니다. 인터넷을 확인하고 다시 준비하세요.',
  'GC-HOST-099':
    '서버 작업에 실패했습니다. 다시 확인하거나 AI 요청문을 복사해 도움을 받으세요.',
};
export async function readHostedProject(directory: string, projectId: string) {
  if (!/^[a-f0-9-]{36}$/.test(projectId)) throw new Error('Invalid project');
  const database = path.join(directory, 'projects/sync.sqlite');
  if (await fs.stat(database).catch(() => null)) {
    const db = new DatabaseSync(database, { readOnly: true });
    try {
      const row = db
        .prepare('SELECT value FROM projects WHERE id=?')
        .get(projectId);
      if (!row) throw new Error('Unknown project');
      return JSON.parse(String(row.value)) as {
        members: { tokenHash: string; removed?: boolean }[];
      };
    } finally {
      db.close();
    }
  }
  const folder = path.join(directory, 'projects', projectId);
  const head = JSON.parse(
    await fs.readFile(path.join(folder, 'head.json'), 'utf8'),
  );
  if (!/^[a-f0-9-]{36}$/.test(head.checkpoint))
    throw new Error('Invalid checkpoint');
  return JSON.parse(
    await fs.readFile(
      path.join(folder, 'checkpoints', head.checkpoint, 'state.json'),
      'utf8',
    ),
  ) as {
    members: { tokenHash: string; removed?: boolean }[];
  };
}
export async function isHostedSession(
  directory: string,
  credentials: CollaborationCredentials,
) {
  try {
    const project = await readHostedProject(directory, credentials.projectId);
    const hash = createHash('sha256').update(credentials.token).digest('hex');
    return project.members.some(
      (member) => !member.removed && member.tokenHash === hash,
    );
  } catch {
    return false;
  }
}

export class SelfHostService {
  private options: HostOptions;
  private running: Promise<SelfHostState> | null = null;
  private currentAction: string | null = null;
  private runtimeDirectory: string;
  private cloudflaredPath: string;
  state: SelfHostState;
  constructor(options: HostOptions) {
    this.options = options;
    this.runtimeDirectory = options.runtimeSource;
    this.cloudflaredPath = path.join(
      options.directory,
      'tools/cloudflared.exe',
    );
    this.state = {
      supported: process.platform === 'win32',
      stage: 'off',
      code: '',
      publicUrl: '',
      message: '준비 상태를 확인하고 서버를 켜세요.',
      closeBehavior: 'ask',
      dataDirectory: options.directory,
      projects: [],
    };
  }
  private publish(value: Partial<SelfHostState>) {
    this.state = { ...this.state, ...value };
    this.options.changed(this.state);
    return this.state;
  }
  async init() {
    try {
      const saved = JSON.parse(
        await fs.readFile(
          path.join(this.options.directory, 'app-settings.json'),
          'utf8',
        ),
      );
      if (['ask', 'background', 'stop'].includes(saved.closeBehavior))
        this.state.closeBehavior = saved.closeBehavior;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        this.publish({
          code: 'GC-HOST-015',
          stage: 'problem',
          message: messages['GC-HOST-015'],
        });
    }
  }
  async setCloseBehavior(closeBehavior: SelfHostState['closeBehavior']) {
    if (!['ask', 'background', 'stop'].includes(closeBehavior))
      throw new Error('종료 설정이 올바르지 않습니다.');
    await fs.mkdir(this.options.directory, { recursive: true });
    const file = path.join(this.options.directory, 'app-settings.json');
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify({ closeBehavior }));
      await fs.rename(temp, file);
    } finally {
      await fs.rm(temp, { force: true });
    }
    return this.publish({ closeBehavior });
  }
  private async prepareRuntime() {
    // Keep the running server independent of Squirrel's versioned app directory.
    const names = [
      'server.mjs',
      'bridge.ps1',
      'connect.ps1',
      'diagnostics.ps1',
      'host.ps1',
      'runtime-version.json',
    ];
    const contents = await Promise.all(
      names.map((name) =>
        fs.readFile(path.join(this.options.runtimeSource, name)),
      ),
    );
    const hash = createHash('sha256');
    for (const bytes of contents) hash.update(bytes);
    const directory = path.join(
      this.options.directory,
      'runtimes',
      hash.digest('hex').slice(0, 24),
    );
    await fs.mkdir(directory, { recursive: true });
    for (const [index, name] of names.entries())
      await fs.writeFile(path.join(directory, name), contents[index]);
    for (const name of ['node.exe', 'NODE-LICENSE.txt']) {
      try {
        await fs.copyFile(
          path.join(this.options.runtimeSource, name),
          path.join(directory, name),
          fs.constants.COPYFILE_EXCL,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    this.runtimeDirectory = directory;
  }
  private async bridge(action: 'Check' | 'Start' | 'Stop' | 'Key') {
    const reportFile = path.join(
      this.options.directory,
      `bridge-${randomUUID()}.json`,
    );
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(this.runtimeDirectory, 'bridge.ps1'),
      '-Action',
      action,
      '-StateDirectory',
      this.options.directory,
      '-RuntimeDirectory',
      this.runtimeDirectory,
      '-CloudflaredPath',
      this.cloudflaredPath,
      '-Port',
      String(this.options.port ?? 4318),
    ];
    if (action !== 'Key') args.push('-ReportFile', reportFile);
    // Avoid PATH hijacking and never log stdout: Key is private main-process data.
    const executable = path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    );
    try {
      if (action !== 'Key') {
        // Detached helpers must not inherit IPC pipes and hold execFile open.
        await new Promise<void>((resolve, reject) => {
          const child = spawn(executable, args, {
            windowsHide: true,
            stdio: 'ignore',
          });
          const timer = setTimeout(() => {
            child.kill();
            reject(new Error('GC-HOST-099'));
          }, 300_000);
          child.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
          });
          child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });
        return (await fs.readFile(reportFile, 'utf8'))
          .trim()
          .replace(/^\uFEFF/, '');
      }
      return (
        await execute(executable, args, {
          windowsHide: true,
          timeout: 300_000,
          maxBuffer: 128 * 1024,
        })
      ).stdout
        .trim()
        .replace(/^\uFEFF/, '');
    } catch (error) {
      const output = (error as { stdout?: string }).stdout
        ?.trim()
        .replace(/^\uFEFF/, '');
      if (action !== 'Key' && output) {
        try {
          const report = JSON.parse(output);
          if (typeof report.code === 'string') return JSON.stringify(report);
        } catch {
          /* sanitized below */
        }
      }
      throw new Error(action === 'Key' ? 'GC-HOST-013' : 'GC-HOST-099');
    } finally {
      if (action !== 'Key')
        await fs.rm(reportFile, { force: true }).catch(() => undefined);
    }
  }
  private async inspect(action: 'Check' | 'Start' | 'Stop') {
    const report = JSON.parse(await this.bridge(action)) as HostReport;
    const code = report.code || '';
    if (!report.checks) throw new Error(code || 'GC-HOST-099');
    const ready =
      report.checks.publicHealthy &&
      report.checks.serverOwnership === 'owned' &&
      report.checks.tunnelOwnership === 'owned';
    this.publish({
      stage: ready
        ? 'ready'
        : code && code !== 'GC-HOST-004'
          ? 'problem'
          : 'off',
      publicUrl: ready
        ? report.publicUrl
        : this.state.publicUrl || report.publicUrl,
      checkedAt: report.checkedAt,
      checks: report.checks,
      code,
      message: ready
        ? '인터넷 연결을 확인했습니다. 프로젝트를 공유하거나 기존 참가자에게 연결 정보를 전달하세요.'
        : code
          ? (messages[code] ?? messages['GC-HOST-099'])
          : '서버가 꺼져 있습니다. 서버 켜기를 눌러주세요.',
    });
    if (ready) await this.refreshProjects(report.publicUrl);
    return this.state;
  }
  private async refreshProjects(serverUrl: string) {
    const projects: SelfHostState['projects'] = [];
    for (const entry of this.options.library.list()) {
      if (!entry.projectId) continue;
      const saved = this.options.library.get(entry.id);
      if (
        !saved.credentials ||
        !(await isHostedSession(this.options.directory, saved.credentials))
      )
        continue;
      if (
        saved.serverUrl !== serverUrl &&
        entry.projectId !== this.options.activeProject()
      )
        await this.options.library.updateServer(entry.id, serverUrl);
      projects.push({
        id: entry.id,
        projectId: entry.projectId,
        name: entry.name,
        inviteAvailable:
          !!saved.credentials.inviteCode && entry.role === 'admin',
      });
    }
    this.publish({ projects });
  }
  async creationKey(serverUrl: string) {
    if (this.running)
      throw new Error('서버 작업이 완료될 때까지 기다려주세요.');
    await this.inspect('Check');
    if (this.state.stage !== 'ready' || this.state.publicUrl !== serverUrl)
      return null;
    const key = await this.bridge('Key');
    if (key.length < 32 || key.length > 256)
      throw new Error('서버 생성 키를 읽지 못했습니다.');
    return key;
  }
  run(action: 'prepare' | 'start' | 'check' | 'stop' | 'restart') {
    if (!['prepare', 'start', 'check', 'stop', 'restart'].includes(action))
      return Promise.reject(new Error('지원하지 않는 서버 작업입니다.'));
    if (this.running)
      return action === 'check' || action === this.currentAction
        ? this.running
        : Promise.reject(
            new Error('서버 작업이 진행 중입니다. 완료 후 다시 시도하세요.'),
          );
    this.currentAction = action;
    this.running = this.runNow(action).finally(() => {
      this.running = null;
      this.currentAction = null;
    });
    return this.running;
  }
  private async runNow(
    action: 'prepare' | 'start' | 'check' | 'stop' | 'restart',
  ) {
    if (!this.state.supported)
      return this.publish({
        message: 'PC 서버는 Windows에서 사용할 수 있습니다.',
      });
    this.publish({
      stage:
        action === 'prepare'
          ? 'preparing'
          : action === 'stop'
            ? 'stopping'
            : action === 'check'
              ? 'checking'
              : 'starting',
      code: '',
      message:
        action === 'prepare'
          ? '공식 연결 도구를 준비하고 있습니다.'
          : '서버와 연결 상태를 확인하고 있습니다.',
    });
    try {
      await this.prepareRuntime();
      if (action === 'prepare') {
        await this.inspect('Check');
        if (
          this.state.checks?.serverOwnership !== 'absent' ||
          this.state.checks?.tunnelOwnership !== 'absent'
        )
          return this.state;
        this.publish({
          stage: 'preparing',
          message: '공식 연결 도구를 다운로드하고 SHA-256을 확인합니다.',
        });
        await this.downloadCloudflared();
        return await this.inspect('Check');
      }
      if (action === 'restart') {
        await this.inspect('Stop');
        this.publish({
          stage: 'starting',
          message:
            '서버와 인터넷 연결을 다시 시작합니다. 주소가 바뀔 수 있습니다.',
        });
      }
      return await this.inspect(
        action === 'check' ? 'Check' : action === 'stop' ? 'Stop' : 'Start',
      );
    } catch (error) {
      const rawCode = error instanceof Error ? error.message : '';
      const code = Object.hasOwn(messages, rawCode) ? rawCode : 'GC-HOST-099';
      return this.publish({ stage: 'problem', code, message: messages[code] });
    }
  }
  private async downloadCloudflared() {
    const temporary = `${this.cloudflaredPath}.${randomUUID()}.download`;
    try {
      if (
        this.state.checks?.serverOwnership === 'owned' ||
        this.state.checks?.tunnelOwnership === 'owned'
      )
        throw new Error('GC-HOST-008');
      const response = await fetch(
        'https://api.github.com/repos/cloudflare/cloudflared/releases/latest',
        {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'Game-Jam-Self-Host',
          },
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (!response.ok) throw new Error('Release unavailable');
      const release = (await response.json()) as {
        assets: {
          name: string;
          browser_download_url: string;
          digest: string;
          size: number;
        }[];
      };
      const arch =
        process.arch === 'arm64'
          ? 'arm64'
          : process.arch === 'ia32'
            ? '386'
            : 'amd64';
      const name = `cloudflared-windows-${arch}.exe`;
      const asset = release.assets.find((item) => item.name === name);
      if (
        !asset ||
        !/^sha256:[a-f0-9]{64}$/.test(asset.digest) ||
        !Number.isSafeInteger(asset.size) ||
        asset.size <= 0 ||
        asset.size > 100 * 1024 * 1024 ||
        !asset.browser_download_url.startsWith(
          'https://github.com/cloudflare/cloudflared/releases/download/',
        ) ||
        !asset.browser_download_url.endsWith(`/${name}`)
      )
        throw new Error('Invalid release metadata');
      const download = await fetch(asset.browser_download_url, {
        signal: AbortSignal.timeout(120_000),
      });
      if (!download.ok || !download.body)
        throw new Error('Download unavailable');
      await fs.mkdir(path.dirname(this.cloudflaredPath), { recursive: true });
      const file = await fs.open(temporary, 'wx');
      const hash = createHash('sha256');
      let size = 0;
      try {
        for await (const chunk of download.body) {
          size += chunk.byteLength;
          if (size > asset.size) throw new Error('Download too large');
          hash.update(chunk);
          await file.writeFile(chunk);
        }
      } finally {
        await file.close();
      }
      if (
        size !== asset.size ||
        `sha256:${hash.digest('hex')}` !== asset.digest
      )
        throw new Error('Checksum mismatch');
      await fs.rename(temporary, this.cloudflaredPath);
    } catch (error) {
      throw new Error(
        error instanceof Error && error.message === 'GC-HOST-008'
          ? error.message
          : 'GC-HOST-DOWNLOAD',
      );
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }
  async info(id: string, kind: 'connection' | 'invite') {
    if (kind !== 'connection' && kind !== 'invite')
      throw new Error('연결 정보 유형이 올바르지 않습니다.');
    await this.run('check');
    if (this.state.stage !== 'ready')
      throw new Error('서버 연결을 먼저 확인해주세요.');
    const entry = this.options.library.get(id);
    if (
      !entry.credentials ||
      !entry.projectId ||
      !(await isHostedSession(this.options.directory, entry.credentials))
    )
      throw new Error('이 PC에서 관리하는 프로젝트를 선택해주세요.');
    if (kind === 'connection')
      return connectionInfo(entry.projectId, this.state.publicUrl);
    if (entry.role !== 'admin' || !entry.credentials.inviteCode)
      throw new Error('관리자 창에서 초대 코드를 발급해주세요.');
    return `Game Jam! 초대\n서버: ${this.state.publicUrl}\n코드: ${entry.credentials.inviteCode}`;
  }
  prompt() {
    return `이 PC의 Game Jam! 인터넷 협업 서버 설정 또는 연결 문제를 해결해줘.\n\n앱 버전: ${this.options.appVersion}\n앱 위치: ${this.options.appPath}\n서버 데이터 위치: ${this.options.directory}\n단계: ${this.state.stage}\n오류 코드: ${this.state.code || '없음'}\n최근 검사: ${this.state.checkedAt || '검사 전'}\n검사 결과: ${JSON.stringify(this.state.checks ?? {})}\n\nCloudflare Quick Tunnel을 사용하며 계정 가입이나 도메인 구매는 필요 없어. 앱의 ‘협업 서버 열기’에서 준비·실행·검사를 우선 진행해줘. 필요한 도구는 공식 배포처에서 준비하고 검증해줘. CLI로 가능한 작업은 직접 처리하고 필요한 경우 사용 가능한 컴퓨터 사용 도구로 화면을 조작해줘. 기존 프로젝트·키·세션과 정상 실행 중인 서버를 보존해줘. 공동 작업에 영향을 주는 종료·재시작이 필요하면 먼저 알려줘. 키·토큰·문서·원본 로그는 답변에 넣지 마. 이 설치판에서 지원하는 명령만 사용하고 개발 저장소 다운로드나 빌드를 요구하지 마. 완료 후 외부 연결과 앱에서 참여·관리하는 방법을 확인해줘. 직접 할 수 없는 단계는 사용자가 할 행동을 하나씩 안내해줘.`;
  }
}
