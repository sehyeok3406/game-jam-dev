import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './process.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const raw = await fs.readFile(
  path.join(root, 'out/game-build-stage0/verification.json'),
);
const report = JSON.parse(raw);
const policy = report.electron.outcomes.map((item) => ({
  id: item.id,
  mode: item.mode,
  ok: item.ok,
  code: item.code,
  ready: item.observed?.ready,
  render: item.observed?.render,
  features: item.observed?.features,
  blocked: item.blocked,
  references: item.references,
  staticMs: item.staticMs,
  errors: item.errors?.map((message) =>
    message.replace(/blob:null\/[a-f0-9-]+/g, 'blob:null/[id]').slice(0, 240),
  ),
  error: item.error?.split(" loading '")[0],
  multiplayerContract: item.multiplayerContract,
}));
const summary = {
  schema: 1,
  date: '2026-11-01',
  sourceCommit: '03d938c',
  scope:
    'Stage-0 synthetic feasibility only; production sources and package dependencies unchanged',
  rawReport: 'out/game-build-stage0/verification.json',
  rawReportSha256: sha256(raw),
  startedAt: report.startedAt,
  finishedAt: report.finishedAt,
  inputs: report.inputs,
  runtime: report.runtime,
  electron: report.electron.versions.electron,
  dependencies: report.dependencies,
  packages: report.metadata,
  lockedPackages: report.lockedPackages,
  licenseNotices: report.licenseNotices,
  cases: report.cases.map(({ file: _file, ...item }) => item),
  largeAsset: report.largeAsset,
  policy,
  browsers: report.browsers.map((browser) => ({
    name: browser.name,
    version: browser.version.product,
    offline: browser.offline,
    outcomes: browser.outcomes.map((item) => ({
      id: item.id,
      ok: item.ok,
      skipped: item.skipped,
      reason: item.reason,
      ready: item.observed?.ready,
      moves: item.observed?.moves,
      render: item.observed?.render,
      features: item.observed?.features,
      httpRequests: item.httpRequests,
    })),
  })),
  limits: report.electron.limits.map(({ rendererError, ...item }) => ({
    ...item,
    rendererError: rendererError?.split(" loading '")[0],
  })),
  offlineReplay: report.offlineReplay,
  packagedRuntime: {
    node: report.packagedRuntime.runtime.node,
    sha256: report.packagedRuntime.sha256,
    builds: report.packagedRuntime.builds,
    payloads: report.packagedRuntime.payloads,
  },
  portableToolset: {
    node: report.portableToolset.node,
    npm: report.portableToolset.npm,
    rolldown: report.portableToolset.rolldown,
    bytes: report.portableToolset.bytes,
    files: report.portableToolset.files,
    fingerprint: report.portableToolset.fingerprint,
    packages: report.portableToolset.packages,
    pathEnvironmentEmpty: report.portableToolset.pathEnvironmentEmpty,
    offlineInstall: report.portableToolset.offlineInstall,
    builds: report.portableToolset.builds,
  },
  expectedSupportedFailures: report.expectedSupportedFailures,
  limitations: [
    'No paid AI calls or provider authentication tests',
    'No production package feature integration or multi-PC/network-room test',
    'Headless local browsers; GPU/browser/device performance is not generally certified',
    'Preview/player policy harnesses use a test-only offline guard; player uses solo SDK rather than the full online shell',
    'Size cases use synthetic comment payloads and JSON; no concurrent HTTP or SQLite durability load test',
    'WebGPU presence is observed only; no WebGPU render test',
    'External export files are retained in the task temporary directory',
  ],
};
await fs.writeFile(
  path.join(root, 'docs/audits/2026-11-01-game-build-stage0-evidence.json'),
  JSON.stringify(summary, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    cases: summary.cases.length,
    electronObservations: policy.length,
    electronPass: policy.filter((item) => item.ok).length,
    browserObservations: summary.browsers.reduce(
      (n, item) => n + item.outcomes.filter((x) => !x.skipped).length,
      0,
    ),
    supportedFailures: summary.expectedSupportedFailures.length,
  }),
);
