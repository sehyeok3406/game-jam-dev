import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runGameTool } from './tool-process.ts';
import type { DependencyPreparationEngine } from '../../../application/ai/dependency-preparation.ts';
import {
  DependencyPreparationLimits as Limits,
  type DependencyPreparationResult,
  type DependencyRequestV1,
} from '../../../contracts/dependency-preparation.ts';
import {
  parseDependencyRequest,
  validateDependencyLock,
} from '../../../core/ai/dependency-preparation.ts';

const digest = (bytes: string | Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
async function safeDirectory(root: string) {
  await fs.mkdir(root, { recursive: true });
  if ((await fs.lstat(root)).isSymbolicLink())
    throw Error('준비 작업 폴더에 심볼릭 링크를 사용할 수 없습니다.');
  return fs.realpath(root);
}
export async function verifyGameBuildRuntime(
  directory: string,
  signal?: AbortSignal,
) {
  const real = await fs.realpath(directory);
  const manifest = JSON.parse(
    await fs.readFile(path.join(real, 'manifest.json'), 'utf8'),
  ) as {
    version: number;
    platform: string;
    arch: string;
    versions: Record<string, string>;
    files: { path: string; bytes: number; sha256: string }[];
    sha256: string;
  };
  if (
    manifest.version !== 1 ||
    manifest.platform !== process.platform ||
    manifest.arch !== process.arch ||
    !Array.isArray(manifest.files) ||
    digest(
      JSON.stringify({ versions: manifest.versions, files: manifest.files }),
    ) !== manifest.sha256
  )
    throw Error('게임 준비 도구 manifest가 올바르지 않습니다.');
  const inventory = new Set(manifest.files.map((file) => file.path));
  if (inventory.size !== manifest.files.length)
    throw Error('게임 준비 도구 manifest 중복');
  const scan = async (relative = '') => {
    for (const entry of await fs.readdir(path.join(real, relative), {
      withFileTypes: true,
    })) {
      const name = [relative, entry.name].filter(Boolean).join('/');
      if (entry.isSymbolicLink())
        throw Error('게임 준비 도구의 링크는 허용하지 않습니다.');
      if (entry.isDirectory()) await scan(name);
      else if (name !== 'manifest.json' && !inventory.has(name))
        throw Error('게임 준비 도구에 미등록 파일이 있습니다.');
    }
  };
  await scan();
  for (const f of manifest.files) {
    signal?.throwIfAborted();
    if (
      !f.path ||
      f.path.includes('..') ||
      f.path.includes('\\') ||
      path.isAbsolute(f.path)
    )
      throw Error('게임 준비 도구 경로 오류');
    const file = path.join(real, f.path);
    if (!path.resolve(await fs.realpath(file)).startsWith(real + path.sep))
      throw Error('게임 준비 도구의 외부 링크');
    const bytes = await fs.readFile(file);
    if (bytes.length !== f.bytes || digest(bytes) !== f.sha256)
      throw Error(`게임 준비 도구 무결성 오류: ${f.path}`);
  }
  for (const required of [
    'node.exe',
    'worker.mjs',
    'builder.mjs',
    'npm/bin/npm-cli.js',
  ])
    if (!manifest.files.some((f) => f.path === required))
      throw Error('게임 준비 도구 누락');
  return { directory: real, sha256: manifest.sha256 };
}
/** Each run gets freshly extracted files; only verified tarballs are reused as a cache. */
type Options = {
  runtime: string;
  cacheRoot: string;
  assertCurrent(): void;
  registryOrigin?: string;
};
let activeWorkers = 0;
export class NodeDependencyPreparationEngine implements DependencyPreparationEngine {
  private workspaces: string[] = [];
  private active = false;
  private options: Options;
  constructor(options: Options) {
    this.options = options;
  }
  async execute(
    request: Exclude<DependencyRequestV1, { action: 'done' }>,
    signal: AbortSignal,
  ): Promise<DependencyPreparationResult> {
    parseDependencyRequest(request);
    signal.throwIfAborted();
    this.options.assertCurrent();
    if (this.active || activeWorkers >= 2)
      throw Error(
        '라이브러리 준비가 이미 진행 중입니다. 잠시 후 다시 시도해주세요.',
      );
    this.active = true;
    activeWorkers++;
    let jobRoot: string | undefined,
      keep = false;
    try {
      const runtime = await verifyGameBuildRuntime(
        this.options.runtime,
        signal,
      );
      signal.throwIfAborted();
      this.options.assertCurrent();
      const cacheRoot = await safeDirectory(this.options.cacheRoot);
      jobRoot = await fs.mkdtemp(path.join(cacheRoot, '.work-'));
      const payload = {
        request,
        jobRoot,
        cacheRoot,
        toolsetSha256: runtime.sha256,
        registryOrigin: this.options.registryOrigin,
      };
      const result = JSON.parse(
        await runGameTool(
          {
            runtime: runtime.directory,
            worker: 'worker.mjs',
            jobRoot,
            payload,
            outputBytes: Limits.resultBytes + 8192,
            timeoutMs: Limits.timeoutMs,
          },
          signal,
        ),
      ) as {
        result?: DependencyPreparationResult;
        error?: { code: string; message: string };
      };
      signal.throwIfAborted();
      this.options.assertCurrent();
      if (result.error)
        throw Object.assign(Error(result.error.message), {
          code: result.error.code,
        });
      if (!result.result || result.result.version !== 1)
        throw Error('게임 준비 결과가 올바르지 않습니다.');
      if (result.result.action === 'prepared') {
        validateDependencyLock(result.result.lock);
        if (
          result.result.lockSha256 !==
            digest(JSON.stringify(result.result.lock)) ||
          result.result.toolsetSha256 !== runtime.sha256
        )
          throw Error('게임 준비 결과 무결성 오류');
        keep = true;
        this.workspaces.push(jobRoot);
      }
      return result.result;
    } finally {
      this.active = false;
      activeWorkers--;
      if (jobRoot && !keep) await this.remove(jobRoot);
    }
  }
  workspace() {
    this.options.assertCurrent();
    const current = this.workspaces.at(-1);
    if (!current) throw Error('준비된 라이브러리 작업 공간이 없습니다.');
    return path.join(current, 'workspace');
  }
  private async remove(directory: string) {
    const base = await fs.realpath(this.options.cacheRoot),
      target = path.resolve(directory);
    if (
      path.dirname(target) !== base ||
      !path.basename(target).startsWith('.work-')
    )
      throw Error('준비 작업 정리 범위를 벗어났습니다.');
    if (
      (await fs.lstat(target)).isSymbolicLink() ||
      (await fs.realpath(target)) !== target
    )
      throw Error('준비 작업 정리 폴더가 변경되었습니다.');
    await fs.rm(target, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
  async close() {
    if (this.active)
      throw Error('준비 프로세스 종료 후 작업 공간을 정리해주세요.');
    const failures: unknown[] = [];
    for (const workspace of this.workspaces.splice(0)) {
      try {
        await this.remove(workspace);
      } catch (cause) {
        this.workspaces.push(workspace);
        failures.push(cause);
      }
    }
    if (failures.length)
      throw new AggregateError(failures, '준비 작업 공간 정리에 실패했습니다.');
  }
}
