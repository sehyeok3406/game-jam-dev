import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type {
  AiProviderId,
  CodexConnectionStatus,
} from '../../../contracts/ai.ts';
import { aiProvider } from '../../../core/ai/catalog.ts';
import {
  GROK_MIN_VERSION,
  grokAuthPath,
  grokVersionSupported,
  prepareGrokProcess,
} from './grok.ts';

export type ProcessCollector = (
  command: string,
  args: string[],
  timeout?: number,
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<{ code: number | null; stdout: string; stderr: string }>;
export type CliCommand = { executable: string; prefix: string[] };
const exists = async (file: string) =>
  fs
    .stat(file)
    .then((stat) => stat.isFile())
    .catch(() => false);

export async function findOtherCli(
  provider: AiProviderId,
  collect: ProcessCollector,
): Promise<CliCommand | null> {
  const name = {
    'claude-cli': 'claude',
    'gemini-cli': 'gemini',
    'grok-cli': 'grok',
  }[provider as Exclude<AiProviderId, 'codex-cli'>];
  if (!name) return null;
  const found = await collect(
    process.platform === 'win32' ? 'where.exe' : 'which',
    [name],
    4000,
  ).catch(() => ({ stdout: '' }));
  const candidates = found.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (provider === 'claude-cli')
    candidates.push(
      path.join(
        os.homedir(),
        '.local',
        'bin',
        process.platform === 'win32' ? 'claude.exe' : 'claude',
      ),
    );
  if (provider === 'grok-cli')
    candidates.push(
      path.join(
        process.env.GROK_HOME || path.join(os.homedir(), '.grok'),
        'bin',
        process.platform === 'win32' ? 'grok.exe' : 'grok',
      ),
    );
  for (const candidate of candidates) {
    if (process.platform !== 'win32' || candidate.endsWith('.exe')) {
      if (await exists(candidate)) return { executable: candidate, prefix: [] };
    }
    // Resolve known npm entrypoints instead of passing user paths/prompts to cmd.exe.
    const entry = path.join(
      path.dirname(candidate),
      'node_modules',
      provider === 'claude-cli'
        ? '@anthropic-ai/claude-code/cli.js'
        : provider === 'gemini-cli'
          ? '@google/gemini-cli/dist/index.js'
          : '@xai-official/grok/bin/grok',
    );
    if (await exists(entry)) {
      const nodes = await collect('where.exe', ['node.exe'], 4000);
      for (const node of nodes.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())) {
        if (node.endsWith('.exe') && (await exists(node)))
          return { executable: node, prefix: [entry] };
      }
    }
  }
  return null;
}

export async function otherCliStatus(
  provider: AiProviderId,
  collect: ProcessCollector,
): Promise<CodexConnectionStatus> {
  const definition = aiProvider(provider);
  const command = await findOtherCli(provider, collect);
  const base = {
    providerId: provider,
    available: false,
    authenticated: false,
    version: null as string | null,
    executablePath: command?.executable ?? null,
  };
  if (!command)
    return {
      ...base,
      message: `${definition.label}를 찾지 못했습니다. 설치 후 로그인해주세요.`,
    };
  try {
    const version = await collect(command.executable, [
      ...command.prefix,
      '--version',
    ]);
    if (version.code !== 0)
      return {
        ...base,
        message:
          'CLI 실행을 확인하지 못했습니다. 설치와 Node.js 버전을 확인해주세요.',
      };
    const status = {
      ...base,
      available: true,
      version: version.stdout.trim().slice(0, 120),
    };
    if (provider === 'grok-cli') {
      if (!grokVersionSupported(status.version))
        return {
          ...status,
          available: false,
          message: `Grok Build ${GROK_MIN_VERSION} 이상으로 업데이트해주세요.`,
        };
      const configured =
        !!process.env.XAI_API_KEY || (await exists(grokAuthPath()));
      const prepared = await prepareGrokProcess(command, collect);
      await prepared.cleanup();
      return {
        ...status,
        supportsReasoningEffort: false,
        authenticated: configured,
        message: configured
          ? 'Grok 인증 정보가 있습니다. 유효성·모델 권한·사용량은 실제 실행 시 검증됩니다.'
          : '터미널에서 grok login으로 로그인하거나 XAI_API_KEY를 설정해주세요.',
      };
    }
    const help = await collect(command.executable, [
      ...command.prefix,
      '--help',
    ]);
    const required =
      provider === 'claude-cli'
        ? ['--restricted', '--strict-mcp-config', '--tools', '--output-format']
        : [
            '--approval-mode',
            '--extensions',
            '--output-format',
            '--skip-trust',
            '--allowed-mcp-server-names',
          ];
    if (help.code !== 0 || required.some((flag) => !help.stdout.includes(flag)))
      return {
        ...status,
        available: false,
        message: `${definition.label} 업데이트가 필요합니다. 안전한 파일 작업에 필요한 CLI 옵션을 지원하지 않습니다.`,
      };
    if (provider === 'claude-cli') {
      const auth = await collect(command.executable, [
        ...command.prefix,
        'auth',
        'status',
      ]);
      return {
        ...status,
        supportsReasoningEffort: help.stdout.includes('--effort'),
        authenticated: auth.code === 0,
        message:
          auth.code === 0
            ? 'Claude 로그인 상태 확인. 계정의 사용량·모델 권한은 실제 실행 시 검증됩니다.'
            : '터미널에서 claude auth login으로 로그인해주세요.',
      };
    }
    // Do not read or expose cached tokens. Presence isn't proof of token validity.
    const cache = await exists(
      path.join(os.homedir(), '.gemini', 'oauth_creds.json'),
    );
    const configured = cache || !!process.env.GEMINI_API_KEY;
    return {
      ...status,
      authenticated: configured,
      message: configured
        ? 'Gemini 인증 정보가 있습니다. 유효성·잔여 사용량은 실제 실행 시 검증됩니다.'
        : '터미널에서 gemini를 실행해 Google 로그인 후 다시 확인해주세요.',
    };
  } catch (error) {
    return {
      ...base,
      message:
        provider === 'grok-cli' && error instanceof Error
          ? error.message
          : 'CLI 상태 확인 실패. 설치·로그인 상태를 터미널에서 확인해주세요.',
    };
  }
}
