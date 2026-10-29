const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const active = new Set(['queued', 'starting', 'running', 'validating']);
const finished = new Set(['completed', 'failed', 'cancelled']);
function busy(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state))
    throw Error('Invalid state');
  if (state.job !== undefined && state.job !== null) {
    if (typeof state.job !== 'object' || Array.isArray(state.job))
      throw Error('Invalid lease');
    return true;
  }
  if (state.aiQueue !== undefined && !Array.isArray(state.aiQueue))
    throw Error('Invalid queue');
  return (state.aiQueue ?? []).some((job) => {
    if (!job || (!active.has(job.status) && !finished.has(job.status)))
      throw Error('Invalid job');
    return active.has(job.status);
  });
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
function inspectAiState(directory) {
  const database = path.join(directory, 'sync.sqlite');
  if (fs.existsSync(database)) {
    const db = new DatabaseSync(database, { readOnly: true });
    try {
      const version = Number(
        db.prepare('PRAGMA user_version').get().user_version,
      );
      if (version < 0 || version > 1) throw Error('Unsupported schema');
      return db
        .prepare('SELECT value FROM projects')
        .all()
        .some((row) => busy(JSON.parse(row.value)));
    } finally {
      db.close();
    }
  }
  if (!fs.existsSync(directory)) return false;
  return fs.readdirSync(directory, { withFileTypes: true }).some((entry) => {
    if (entry.isSymbolicLink()) throw Error('Invalid project link');
    if (!entry.isDirectory()) return false;
    if (['.project-trash', '.project-lifecycle'].includes(entry.name))
      return false;
    if (!/^[a-f0-9-]{36}$/.test(entry.name) || entry.isSymbolicLink())
      throw Error('Invalid project directory');
    const folder = path.join(directory, entry.name);
    const runtime = path.join(folder, 'runtime.json');
    if (fs.existsSync(runtime)) return busy(readJson(runtime));
    const head = readJson(path.join(folder, 'head.json'));
    if (
      typeof head.checkpoint !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(head.checkpoint)
    )
      throw Error('Invalid checkpoint');
    return busy(
      readJson(path.join(folder, 'checkpoints', head.checkpoint, 'state.json')),
    );
  });
}
module.exports = { inspectAiState };
if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw Error('Invalid input');
    const running = inspectAiState(process.argv[2]);
    process.stdout.write(running ? 'busy' : 'idle');
    process.exitCode = running ? 10 : 0;
  } catch {
    // Never print private project JSON, SQLite errors or file contents.
    process.stdout.write('unavailable');
    process.exitCode = 1;
  }
}
