import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const DAY = 86_400_000;
export const POLICY = 'test-caches-only-v2';
export const MIN_AGE_DAYS = 5;
const MAX_PLAN_AGE = DAY;
const browserCaches = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GPUPersistentCache',
  'GrShaderCache',
  'ShaderCache',
]);
const profiles = [
  'ai-queue-ui',
  'ai-run-dismissal',
  'canvas-chrome',
  'canvas-selection-ui',
  'canvas-sheets-ui',
  'document-links-ui',
  'drawing-ui',
  'game-ui-ui',
  'gamejam-approval',
  'gamejam-history',
  'gamejam-materials',
  'gamejam-validation',
  'html-preview-ui',
  'sync-ui',
  'ui-debug-qa',
  'ui-review',
];
const repeatedProfiles = [
  'presentation-actions-ui',
  'section-actions-ui',
  'selection-actions-ui',
  'workspace-panels-ui',
];
const viteRoots = [...repeatedProfiles, 'real-save-ui', 'sync-ui'];
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = (value) => createHash('sha256').update(value).digest('hex');

async function optionalStat(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// Every ancestor is checked separately; never follow a junction into another tree.
export async function safeArtifactPath(root, relative) {
  if (
    typeof relative !== 'string' ||
    !(relative === 'out' || relative.startsWith('out/')) ||
    relative.includes('\\') ||
    relative.includes(':') ||
    relative.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw Error(`Unsafe artifact path: ${relative}`);
  const target = path.resolve(root, relative);
  const boundary = path.relative(root, target);
  if (!boundary || boundary.startsWith('..') || path.isAbsolute(boundary))
    throw Error(`Artifact outside workspace: ${relative}`);
  let current = root;
  for (const part of relative.split('/')) {
    if (await optionalStat(path.join(current, '.cleanup-keep')))
      throw Error(`Pinned by .cleanup-keep: ${relative}`);
    current = path.join(current, part);
    const stat = await optionalStat(current);
    if (!stat) throw Error(`Artifact disappeared: ${relative}`);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw Error(`Link or non-directory in artifact path: ${relative}`);
  }
  if (await optionalStat(path.join(current, '.cleanup-keep')))
    throw Error(`Pinned by .cleanup-keep: ${relative}`);
  if ((await fs.realpath(target)) !== target)
    throw Error(`Artifact path does not resolve to itself: ${relative}`);
  return target;
}

async function snapshot(directory, contentHashes = false) {
  const rows = [];
  let bytes = 0;
  let files = 0;
  let newest = 0;
  async function visit(target, relative) {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) throw Error(`Link inside artifact: ${relative}`);
    if (!stat.isFile() && !stat.isDirectory())
      throw Error(`Special file inside artifact: ${relative}`);
    newest = Math.max(newest, stat.mtimeMs, stat.ctimeMs, stat.birthtimeMs);
    const row = [
      relative,
      stat.isDirectory() ? 'd' : 'f',
      stat.size,
      stat.mtimeMs,
      stat.ctimeMs,
      stat.birthtimeMs,
      stat.ino,
      stat.dev,
    ];
    if (stat.isDirectory()) {
      rows.push(row);
      const names = (await fs.readdir(target)).sort();
      if (names.includes('.cleanup-keep') || names.includes('.git'))
        throw Error(`Pinned or Git directory inside artifact: ${relative}`);
      for (const name of names)
        await visit(path.join(target, name), `${relative}/${name}`);
    } else {
      bytes += stat.size;
      files++;
      if (contentHashes) {
        const digest = createHash('sha256');
        for await (const chunk of createReadStream(target))
          digest.update(chunk);
        row.push(digest.digest('hex'));
        const after = await fs.lstat(target);
        if (
          after.size !== stat.size ||
          after.mtimeMs !== stat.mtimeMs ||
          after.ctimeMs !== stat.ctimeMs ||
          after.ino !== stat.ino
        )
          throw Error(`Artifact changed while scanning: ${relative}`);
      }
      rows.push(row);
    }
  }
  await visit(directory, '');
  return { bytes, files, newest, fingerprint: hash(JSON.stringify(rows)) };
}

async function listDirectories(root, relative) {
  if (!(await optionalStat(path.resolve(root, relative)))) return [];
  const directory = await safeArtifactPath(root, relative);
  return (await fs.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
}

async function discover(root) {
  const results = viteRoots.map((name) => ({
    path: `out/${name}/vite-cache`,
    kind: 'vite-test-cache',
  }));
  const addProfile = (relative) => {
    for (const name of browserCaches)
      results.push({
        path: `${relative}/${name}`,
        kind: 'chromium-test-cache',
      });
  };
  for (const name of profiles) addProfile(`out/${name}/profile`);
  for (const name of repeatedProfiles) {
    const relative = `out/${name}/profiles`;
    // Keep even caches of the two most recently modified UUID profiles.
    const entries = [];
    for (const id of await listDirectories(root, relative)) {
      if (!uuid.test(id)) continue;
      const target = await safeArtifactPath(root, `${relative}/${id}`);
      const state = await snapshot(target);
      entries.push({ id, newest: state.newest });
    }
    entries.sort((a, b) => b.newest - a.newest || a.id.localeCompare(b.id));
    for (const entry of entries.slice(2)) addProfile(`${relative}/${entry.id}`);
  }
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

async function trackedArtifacts(root) {
  const { stdout } = await exec('git', ['ls-files', '-z', '--', 'out'], {
    cwd: root,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.split('\0').filter(Boolean);
}

export function planId(plan) {
  const { id: _id, ...body } = plan;
  return hash(JSON.stringify(body));
}

export async function createCleanupPlan(root, { now = Date.now() } = {}) {
  root = await fs.realpath(root);
  const tracked = await trackedArtifacts(root);
  const candidates = [];
  const deferred = [];
  const discovered = await discover(root);
  for (const item of discovered) {
    if (!(await optionalStat(path.resolve(root, item.path)))) continue;
    try {
      const target = await safeArtifactPath(root, item.path);
      if (
        tracked.some(
          (name) => name === item.path || name.startsWith(item.path + '/'),
        )
      )
        throw Error('Contains Git-tracked files');
      const metadata = await snapshot(target);
      if (!metadata.files || !metadata.bytes) continue;
      if (metadata.newest > now - MIN_AGE_DAYS * DAY)
        throw Error(`Changed or created within the last ${MIN_AGE_DAYS} days`);
      // Recent caches do not need an expensive full-content read on every build.
      const state = await snapshot(target, true);
      if (
        state.newest !== metadata.newest ||
        state.bytes !== metadata.bytes ||
        state.files !== metadata.files
      )
        throw Error('Artifact changed while planning');
      candidates.push({
        ...item,
        ...state,
        reason:
          item.kind === 'vite-test-cache'
            ? 'Test-only Vite dependency cache; regenerated by its test runner'
            : 'Test-only Chromium HTTP/code/GPU cache; profile data is preserved',
      });
    } catch (error) {
      deferred.push({ ...item, reason: error.message });
    }
  }
  const plan = {
    schema: 1,
    policy: POLICY,
    root,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + MAX_PLAN_AGE).toISOString(),
    minAgeDays: MIN_AGE_DAYS,
    candidates,
    deferred,
    totalBytes: candidates.reduce((sum, item) => sum + item.bytes, 0),
  };
  return { ...plan, id: planId(plan) };
}

export const formatBytes = (bytes) => `${(bytes / 1024 ** 2).toFixed(1)} MiB`;

export function renderCleanupPlan(plan) {
  return [
    '# 개발 결과물 정리 승인 목록',
    '',
    `계획 ID: \`${plan.id}\``,
    `생성: ${plan.createdAt} / 만료: ${plan.expiresAt}`,
    '',
    `삭제 후보: ${plan.candidates.length}개 캐시 폴더, ${formatBytes(plan.totalBytes)}`,
    '',
    '이 보고서 생성은 파일을 삭제하지 않습니다. 사람의 명시적 승인 후에만 적용하세요.',
    '',
    '| 경로 | 크기 | 종류 | 마지막 변경(UTC) |',
    '|---|---:|---|---|',
    ...plan.candidates.map(
      (item) =>
        `| ${item.path} | ${formatBytes(item.bytes)} | ${item.kind} | ${new Date(item.newest).toISOString()} |`,
    ),
    '',
    '보존: 소스·Git·의존성·빌드/배포 파일·런타임·서버 번들·프로젝트·프로필 저장 데이터·검증 로그·스크린샷·알 수 없는 항목.',
    `${plan.minAgeDays}일 미만 변경/생성, 최근 UUID 프로필 2개, 링크/접합점, .cleanup-keep, Git 추적 파일은 제외합니다.`,
    '적용 전 전체 목록을 재분석합니다. 변경·실행 중 프로세스·확인 실패가 있으면 중단합니다.',
    '',
    '## 보류된 캐시',
    '',
    ...plan.deferred.map((item) => `- ${item.path}: ${item.reason}`),
    '',
  ].join('\n');
}

export async function assertWorkspaceIdle(root) {
  if (process.platform !== 'win32')
    throw Error('Apply requires the Windows process guard');
  const { stdout } = await exec(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress',
    ],
    { windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
  );
  const processes = JSON.parse(stdout);
  const busy = blockingProcesses(root, processes, process.pid);
  if (busy.length)
    throw Error(
      `Workspace may be in use; close builds/tests/servers: ${busy.map((item) => `${item.Name} (${item.ProcessId})`).join(', ')}`,
    );
}

export function blockingProcesses(root, processes, ownPid) {
  if (
    !Array.isArray(processes) ||
    !processes.some((item) => item.ProcessId === ownPid)
  )
    throw Error('Cannot establish process inventory');
  const ancestors = new Set();
  let id = ownPid;
  while (id && !ancestors.has(id)) {
    ancestors.add(id);
    id = processes.find((item) => item.ProcessId === id)?.ParentProcessId;
  }
  const prefix = root.toLowerCase();
  return processes.filter((item) => {
    if (ancestors.has(item.ProcessId)) return false;
    const exe = (item.ExecutablePath ?? '').toLowerCase();
    const command = (item.CommandLine ?? '').toLowerCase();
    const worker = /^(node|electron|game canvas|game jam!)\.exe$/i.test(
      item.Name,
    );
    if (worker && !item.CommandLine) return true;
    return (
      exe.startsWith(prefix + path.sep) ||
      (worker &&
        (command.includes(prefix) ||
          /(?:tests[/\\]|scripts[/\\]|out[/\\]|electron-forge|\bvite\b)/.test(
            command,
          )))
    );
  });
}

export async function applyCleanupPlan(
  root,
  plan,
  approval,
  { now = Date.now(), assertIdle = assertWorkspaceIdle } = {},
) {
  root = await fs.realpath(root);
  if (
    plan.schema !== 1 ||
    plan.policy !== POLICY ||
    plan.root !== root ||
    plan.id !== approval ||
    planId(plan) !== approval
  )
    throw Error('Plan identity or approval does not match');
  const created = Date.parse(plan.createdAt);
  const expires = Date.parse(plan.expiresAt);
  if (
    !Number.isFinite(created) ||
    !Number.isFinite(expires) ||
    created > now ||
    expires <= now ||
    expires - created !== MAX_PLAN_AGE
  )
    throw Error('Plan expired or has invalid timestamps; generate a new plan');
  await assertIdle(root);
  const fresh = await createCleanupPlan(root, { now });
  const current = new Map(fresh.candidates.map((item) => [item.path, item]));
  const selected = new Set();
  for (const item of plan.candidates) {
    if (selected.has(item.path)) throw Error('Duplicate plan entry');
    selected.add(item.path);
    if (JSON.stringify(current.get(item.path)) !== JSON.stringify(item))
      throw Error(`Candidate changed or is no longer eligible: ${item.path}`);
  }
  // Preflight the entire approved set before deleting anything.
  for (const item of plan.candidates) await safeArtifactPath(root, item.path);
  const deleted = [];
  const receipt = {
    planId: plan.id,
    startedAt: new Date(now).toISOString(),
    deleted,
  };
  const receiptPath = path.join(
    root,
    'out/artifact-cleanup',
    `${plan.id}.receipt.json`,
  );
  await safeArtifactPath(root, 'out/artifact-cleanup');
  await fs.writeFile(receiptPath, JSON.stringify(receipt, null, 2), {
    flag: 'wx',
  });
  const saveReceipt = async () => {
    await safeArtifactPath(root, 'out/artifact-cleanup');
    const stat = await fs.lstat(receiptPath);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw Error('Unsafe receipt file');
    await fs.writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  };
  try {
    for (const item of plan.candidates) {
      await assertIdle(root);
      const target = await safeArtifactPath(root, item.path);
      if ((await snapshot(target, true)).fingerprint !== item.fingerprint)
        throw Error(`Artifact changed before deletion: ${item.path}`);
      // This exact, resolved cache directory has passed the workspace boundary check.
      await fs.rm(target, { recursive: true, force: false, maxRetries: 0 });
      deleted.push({ path: item.path, bytes: item.bytes });
      await saveReceipt();
    }
    receipt.completedAt = new Date().toISOString();
  } catch (error) {
    receipt.error = error.message;
    throw error;
  } finally {
    await saveReceipt();
  }
  return receipt;
}
