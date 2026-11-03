import { spawn } from 'node:child_process';
/** Only fixed, packaged workers. Package scripts and user environment are never executed. */
export async function runGameTool(
  input: {
    runtime: string;
    worker: 'worker.mjs' | 'builder.mjs';
    jobRoot: string;
    payload: unknown;
    outputBytes: number;
    timeoutMs: number;
  },
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      PATH: input.runtime,
      HOME: input.jobRoot,
      USERPROFILE: input.jobRoot,
      TMP: input.jobRoot,
      TEMP: input.jobRoot,
    };
    for (const key of ['SystemRoot', 'WINDIR', 'ComSpec'])
      if (process.env[key]) env[key] = process.env[key];
    const child = spawn(
      `${input.runtime}/node.exe`,
      [`${input.runtime}/${input.worker}`],
      {
        cwd: input.jobRoot,
        windowsHide: true,
        shell: false,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let stdout = Buffer.alloc(0),
      stderr = '',
      failure: Error | undefined;
    const abort = () => child.kill();
    const timer = setTimeout(() => {
      failure = Error('게임 제작 도구 실행 시간이 초과되었습니다.');
      child.kill();
    }, input.timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length + chunk.length > input.outputBytes) {
        failure = Error('게임 제작 도구 응답 크기를 초과했습니다.');
        child.kill();
      } else stdout = Buffer.concat([stdout, chunk]);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    child.stdin.on('error', () => {});
    child.once('error', (cause) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(cause);
    });
    child.once('close', () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(signal.reason);
      else if (failure) reject(failure);
      else if (!stdout.length)
        reject(Error('게임 제작 도구 응답 오류: ' + stderr));
      else resolve(stdout.toString('utf8'));
    });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else child.stdin.end(JSON.stringify(input.payload));
  });
}
