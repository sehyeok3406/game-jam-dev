import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { SqliteProjectRepository } from '../src/adapters/sqlite/project-repository.ts';
import { ServerLimits } from '../src/contracts/server-limits.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';

// Synthetic storage measurements only; no user directories, network or deployment.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-r08-measure-'));
const filename = path.join(root, 'sync.sqlite');
const output = path.resolve(
  process.argv[2] ?? 'out/r08-storage-measurement.json',
);
let repo;
const body = (project, revision) =>
  `---\nid: synthetic-${project}-${revision}\ntitle: Synthetic\n---\n` +
  'x'.repeat(4096);
const memory = () => {
  global.gc?.();
  const { rss, heapUsed } = process.memoryUsage();
  return { rss, heapUsed };
};
try {
  repo = new SqliteProjectRepository(filename);
  const populationStart = performance.now();
  for (let index = 0; index < ServerLimits.projects; index++) {
    const files = Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [`ideas/${i}.md`, body(index, i)]),
    );
    const history = Array.from({ length: ServerLimits.history }, (_, i) => ({
      entry: { id: randomUUID(), revision: i + 1 },
      before: { 'ideas/0.md': body(index, i) },
      after: { 'ideas/0.md': body(index, i + 1) },
    }));
    await repo.commit({
      id: randomUUID(),
      name: `Synthetic ${index}`,
      revision: 301,
      files,
      history,
      applied: [],
      members: [],
      revisions: {},
      authorship: {},
      job: null,
      lastRun: null,
      inviteHash: '',
      inviteExpiresAt: 0,
      recoveryHash: '',
    });
  }
  const populationMs = performance.now() - populationStart;
  await repo.close();
  repo = undefined;
  const beforeLoad = memory(),
    start = performance.now();
  repo = new SqliteProjectRepository(filename);
  let loaded = await repo.loadAll();
  const loadMs = performance.now() - start,
    afterLoad = memory(),
    loadedCache = repo.metrics();
  const samples = [],
    p = loaded[0];
  // Each save evicts history; the current cache still retains older body strings.
  for (let revision = 302; revision < 902; revision++) {
    const before = p.files['ideas/0.md'],
      after = body(0, revision);
    p.files['ideas/0.md'] = after;
    p.revision = revision;
    p.history.push({
      entry: { id: randomUUID(), revision },
      before: { 'ideas/0.md': before },
      after: { 'ideas/0.md': after },
    });
    p.history = p.history.slice(-ServerLimits.history);
    const started = performance.now();
    await repo.commit(p);
    samples.push(performance.now() - started);
  }
  const afterSaves = memory(),
    saveCache = repo.metrics();
  loaded = null;
  await repo.close();
  repo = undefined;
  const dbBytes = (await fs.stat(filename)).size;
  const serverStart = performance.now();
  const running = await createCollaborationServer({
    dataDirectory: root,
    port: 0,
  });
  const serverStartupMs = performance.now() - serverStart;
  await running.close();
  samples.sort((a, b) => a - b);
  const report = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    synthetic: {
      projects: ServerLimits.projects,
      currentFilesEach: 8,
      historyEach: ServerLimits.history,
      bodyBytes: 4096,
      additionalSavesOneProject: 600,
    },
    populationMs,
    loadMs,
    serverStartupMs,
    beforeLoad,
    afterLoad,
    afterSaves,
    loadedCache,
    saveCache,
    dbBytes,
    saveMs: {
      median: samples[Math.floor(samples.length / 2)],
      p95: samples[Math.floor(samples.length * 0.95)],
      max: samples.at(-1),
    },
    boundedCacheFollowup: saveCache.cachedBodies > loadedCache.cachedBodies,
  };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await repo?.close();
  await fs.rm(root, { recursive: true, force: true });
}
