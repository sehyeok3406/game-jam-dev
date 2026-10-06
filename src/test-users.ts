import fs from 'node:fs/promises';
import path from 'node:path';
import {
  randomUUID,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { CollaborationClient } from './collaboration-client.ts';
import { CanvasError } from './app-errors.ts';
import type { LaunchTestUsersInput, TestUserWindow } from './shared.ts';

export const TEST_PROFILE_FLAG = '--game-canvas-test-profile=';
export const MAX_TEST_WINDOWS = 10;
export const TEST_BOOTSTRAP_KEY_ENV = 'GAME_CANVAS_TEST_BOOTSTRAP_KEY';

// Electron's storage cipher belongs to each Chromium profile. Transfer only
// participant credentials with a one-use key; the child saves its own session.
export function encryptTestBootstrap(text: string) {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final(),
  ]);
  return {
    key: key.toString('hex'),
    ciphertext: Buffer.concat([nonce, cipher.getAuthTag(), encrypted]),
  };
}
export function decryptTestBootstrap(ciphertext: Buffer, key: string) {
  if (!/^[a-f0-9]{64}$/.test(key) || ciphertext.length < 29)
    throw new CanvasError(
      'GC-TEST-001',
      '테스트 사용자 연결 정보가 잘못되었습니다.',
    );
  const cipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'hex'),
    ciphertext.subarray(0, 12),
  );
  cipher.setAuthTag(ciphertext.subarray(12, 28));
  return Buffer.concat([
    cipher.update(ciphertext.subarray(28)),
    cipher.final(),
  ]).toString('utf8');
}

// Accept an ID, never a renderer-supplied filesystem path.
export function testProfilePath(base: string, args: string[]) {
  const flags = args.filter((arg) => arg.startsWith(TEST_PROFILE_FLAG));
  if (!flags.length) return null;
  const id = flags[0].slice(TEST_PROFILE_FLAG.length);
  if (
    flags.length !== 1 ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
  )
    throw new CanvasError(
      'GC-TEST-001',
      '테스트 사용자 프로필 ID가 잘못되었습니다.',
    );
  return path.join(base, 'test-users', id);
}

export function testLaunchArgs(packaged: boolean, appPath: string, id: string) {
  return [...(packaged ? [] : [appPath]), `${TEST_PROFILE_FLAG}${id}`];
}

export class TestUserLauncher {
  private sequence = 0;
  private busy = false;
  private windows = new Map<
    string,
    TestUserWindow & { profile: string; child?: ChildProcess }
  >();
  private options: {
    base: string;
    executable: string;
    appPath: string;
    packaged: boolean;
    spawn?: typeof spawn;
  };
  constructor(options: TestUserLauncher['options']) {
    this.options = options;
  }

  hasActiveWindows() {
    // Check every launched project, including windows left open after switching projects.
    return (
      this.busy ||
      [...this.windows.values()].some(
        (item) =>
          ['starting', 'ready'].includes(item.status) ||
          (item.status !== 'closed' && item.child?.exitCode === null),
      )
    );
  }

  async list(projectId?: string) {
    const result: TestUserWindow[] = [];
    for (const item of this.windows.values()) {
      if (item.projectId !== projectId) continue;
      if (item.status === 'starting') {
        try {
          const ready = JSON.parse(
            await fs.readFile(
              path.join(item.profile, 'launch-status.json'),
              'utf8',
            ),
          );
          if (ready.status === 'ready' || ready.status === 'failed') {
            item.status =
              ready.status === 'ready' && ready.windowVisible !== true
                ? 'failed'
                : ready.status;
            item.message =
              item.status === 'failed' && ready.status === 'ready'
                ? '[GC-TEST-002] 서버에 접속했지만 창 표시를 확인하지 못했습니다.'
                : ready.message;
          }
        } catch {
          /* The child has not finished starting yet. */
        }
      }
      const { profile: _profile, child: _child, ...publicItem } = item;
      result.push(publicItem);
    }
    return result;
  }

  async launch(owner: CollaborationClient, input: LaunchTestUsersInput) {
    if (this.busy)
      throw new CanvasError(
        'GC-TEST-001',
        '테스트 창을 실행하고 있습니다. 잠시 기다려주세요.',
      );
    if (
      !input ||
      !Number.isInteger(input.count) ||
      input.count < 1 ||
      input.count > MAX_TEST_WINDOWS ||
      !['editor', 'viewer'].includes(input.role) ||
      typeof input.nicknamePrefix !== 'string' ||
      !input.nicknamePrefix.trim() ||
      input.nicknamePrefix.trim().length > 24
    )
      throw new CanvasError(
        'GC-TEST-001',
        '인원은 1~10명, 역할은 편집자 또는 뷰어, 이름 접두어는 1~24자로 입력해주세요.',
      );
    this.busy = true;
    try {
      await owner.refresh();
      if (!owner.state.connected || owner.state.role !== 'admin')
        throw new CanvasError(
          'GC-TEST-001',
          '서버에 연결된 관리자만 테스트 사용자를 실행할 수 있습니다.',
        );
      if (!owner.credentials.inviteCode)
        throw new CanvasError(
          'GC-TEST-001',
          '초대 코드를 먼저 재발급해주세요.',
        );
      const running = [...this.windows.values()].filter((item) =>
        item.child
          ? item.child.exitCode === null &&
            !item.child.killed &&
            !!item.child.pid
          : item.status === 'starting',
      ).length;
      if (running + input.count > MAX_TEST_WINDOWS)
        throw new CanvasError(
          'GC-TEST-001',
          'PC 부하를 줄이기 위해 테스트 창은 동시에 최대 10개까지 실행합니다. 기존 창을 닫아주세요.',
        );
      if (owner.state.members.length + input.count > 20)
        throw new CanvasError(
          'GC-TEST-001',
          '프로젝트는 관리자 포함 최대 20명입니다. 사용하지 않는 참여자를 제외한 후 다시 실행해주세요.',
        );
      for (let index = 0; index < input.count; index++) {
        const id = randomUUID();
        const nickname = `${input.nicknamePrefix.trim()} ${++this.sequence}`;
        const profile = testProfilePath(this.options.base, [
          `${TEST_PROFILE_FLAG}${id}`,
        ])!;
        const joined = await CollaborationClient.join(
          owner.credentials.serverUrl,
          owner.credentials.inviteCode,
          nickname,
        );
        const memberId = joined.result.state.memberId!;
        const item = {
          id,
          nickname,
          memberId,
          projectId: joined.credentials.projectId,
          role: input.role,
          status: 'starting' as TestUserWindow['status'],
          profile,
          message: undefined as string | undefined,
          child: undefined as ChildProcess | undefined,
        };
        this.windows.set(id, item);
        try {
          if (input.role === 'viewer') await owner.setRole(memberId, 'viewer');
          await fs.mkdir(profile, { recursive: true });
          // Never put invitation codes or session tokens on the command line.
          const bootstrap = encryptTestBootstrap(
            JSON.stringify({
              credentials: joined.credentials,
              localRoot: null,
            }),
          );
          await fs.writeFile(
            path.join(profile, 'bootstrap.enc'),
            bootstrap.ciphertext,
            { mode: 0o600 },
          );
          await fs.writeFile(
            path.join(profile, 'test-user.json'),
            JSON.stringify({ nickname, memberId }),
            { mode: 0o600 },
          );
          const env = { ...process.env };
          delete env.ELECTRON_RUN_AS_NODE;
          env[TEST_BOOTSTRAP_KEY_ENV] = bootstrap.key;
          const child = (this.options.spawn ?? spawn)(
            this.options.executable,
            testLaunchArgs(this.options.packaged, this.options.appPath, id),
            {
              stdio: 'ignore',
              detached: true,
              // This is a user-controlled GUI, not a background CLI helper.
              windowsHide: false,
              env,
            },
          );
          item.child = child;
          child.on('error', () => {
            item.status = 'failed';
            item.message = '테스트 앱 프로세스를 실행하지 못했습니다.';
          });
          child.on('exit', (code) => {
            item.status = code === 0 ? 'closed' : 'failed';
            if (code !== 0)
              item.message = `테스트 앱이 종료되었습니다 (종료 코드: ${code ?? '알 수 없음'}).`;
          });
          await new Promise<void>((resolve, reject) => {
            child.once('spawn', resolve);
            child.once('error', reject);
          });
          child.unref();
        } catch {
          item.status = 'failed';
          item.message =
            '테스트 창 준비에 실패했습니다. 실행 권한과 저장 공간을 확인해주세요.';
          await owner.setRole(memberId, 'removed').catch(() => undefined);
        }
      }
      await owner.refresh();
      return this.list(owner.credentials.projectId);
    } finally {
      this.busy = false;
    }
  }
}
