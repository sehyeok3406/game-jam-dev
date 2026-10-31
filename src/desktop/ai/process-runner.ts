import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export type ProcessResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

export const collectProcess = (
  command: string,
  args: string[],
  timeoutMs = 10_000,
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<ProcessResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });

export const terminateProcessTree = async (
  child: ChildProcessWithoutNullStreams,
) => {
  if (child.killed) return;
  if (process.platform === 'win32' && child.pid) {
    try {
      const result = await collectProcess(
        'taskkill.exe',
        ['/pid', String(child.pid), '/T', '/F'],
        5_000,
      );
      if (result.code === 0) return;
    } catch {
      // Fall back to terminating the Codex parent process directly.
    }
  }
  child.kill();
};
