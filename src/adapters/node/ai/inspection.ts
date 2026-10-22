import fs from 'node:fs/promises';
import path from 'node:path';
import type { CodexConnectionStatus } from '../../../contracts/ai.ts';
import type { ProcessCollector } from './discovery.ts';

export const findCodexExecutable = async (collectProcess: ProcessCollector) => {
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    try {
      const found = await collectProcess('where.exe', ['codex'], 4_000);
      candidates.push(
        ...found.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.toLowerCase().endsWith('.exe')),
      );
    } catch {
      // Continue with the desktop-app installation fallback below.
    }
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const binRoot = path.join(localAppData, 'OpenAI', 'Codex', 'bin');
      try {
        const versions = await fs.readdir(binRoot, { withFileTypes: true });
        for (const version of versions) {
          if (version.isDirectory())
            candidates.push(path.join(binRoot, version.name, 'codex.exe'));
        }
      } catch {
        // Codex desktop is not installed in its standard location.
      }
    }
  } else {
    try {
      const found = await collectProcess('which', ['codex'], 4_000);
      candidates.push(found.stdout.trim());
    } catch {
      // No executable on PATH.
    }
  }

  for (const candidate of new Set(candidates)) {
    if (!candidate) continue;
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // Try the next resolved path.
    }
  }
  return null;
};

export const inspectCodex = async (
  collectProcess: ProcessCollector,
): Promise<CodexConnectionStatus> => {
  const executablePath = await findCodexExecutable(collectProcess);
  if (!executablePath) {
    return {
      available: false,
      authenticated: false,
      version: null,
      executablePath: null,
      message: 'Codex CLI를 찾지 못했습니다.',
    };
  }
  try {
    const [versionResult, authResult] = await Promise.all([
      collectProcess(executablePath, ['--version']),
      collectProcess(executablePath, ['login', 'status']),
    ]);
    const version = versionResult.stdout.trim() || versionResult.stderr.trim();
    const authenticated = authResult.code === 0;
    return {
      available: versionResult.code === 0,
      authenticated,
      version: version || null,
      executablePath,
      message: authenticated
        ? 'Codex CLI가 ChatGPT 계정에 연결되어 있습니다.'
        : authResult.stderr.trim() ||
          authResult.stdout.trim() ||
          'Codex CLI 로그인이 필요합니다.',
    };
  } catch (error) {
    return {
      available: false,
      authenticated: false,
      version: null,
      executablePath,
      message: error instanceof Error ? error.message : String(error),
    };
  }
};
