const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const keyPattern = /^[A-Za-z0-9_-]{43}$/;
const digest = (key) => createHash('sha256').update(key).digest('hex');
const readJson = async (file) =>
  JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));

// Keys stay in memory. Callers must serialize only publicInfo(), never these records.
async function findRecoveryKeys(
  profile,
  stateDirectory,
  decrypt,
  { includeUnavailable = false } = {},
) {
  const candidates = [];
  for (const file of [
    'collaboration-session.enc',
    'projects.enc',
    'admin-recovery.enc',
  ]) {
    try {
      const parsed = JSON.parse(
        decrypt(await fs.readFile(path.join(profile, file))),
      );
      for (const entry of Array.isArray(parsed) ? parsed : [parsed]) {
        const credentials = entry?.credentials ?? entry;
        if (uuid.test(credentials?.projectId))
          candidates.push({
            projectId: credentials.projectId,
            recoveryKey: keyPattern.test(credentials?.recoveryKey)
              ? credentials.recoveryKey
              : undefined,
            source: file,
          });
      }
    } catch {
      // A missing/unreadable source must not hide a usable key in another source.
    }
  }
  const found = [];
  for (const projectId of new Set(candidates.map((item) => item.projectId))) {
    try {
      const directory = path.join(stateDirectory, 'projects', projectId);
      const head = await readJson(path.join(directory, 'head.json'));
      if (!uuid.test(head.checkpoint)) continue;
      const state = await readJson(
        path.join(directory, 'checkpoints', head.checkpoint, 'state.json'),
      );
      if (state.id !== projectId || !/^[a-f0-9]{64}$/.test(state.recoveryHash))
        continue;
      const candidate = candidates.find(
        (item) =>
          item.projectId === projectId &&
          item.recoveryKey &&
          digest(item.recoveryKey) === state.recoveryHash,
      );
      if (!candidate && !includeUnavailable) continue;
      found.push({
        projectId,
        name: typeof state.name === 'string' ? state.name : '공동 프로젝트',
        recoveryKey: candidate?.recoveryKey,
        source: candidate?.source,
      });
    } catch {
      // Unrelated hosts, damaged checkpoints and expired backups are not copied.
    }
  }
  return found;
}

function publicInfo(record) {
  return {
    projectId: record.projectId,
    name: record.name,
    source: record.source,
    recoveryKeyAvailable: !!record.recoveryKey,
  };
}

async function currentServerUrl(stateDirectory) {
  try {
    const runtime = await readJson(path.join(stateDirectory, 'runtime.json'));
    return typeof runtime.publicUrl === 'string' &&
      /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(runtime.publicUrl)
      ? runtime.publicUrl
      : '';
  } catch {
    return '';
  }
}

function copyValue(records, projectId, mode = 'Key', serverUrl = '') {
  const record = records.find((item) => item.projectId === projectId);
  if (!record) throw new Error('PROJECT_NOT_FOUND');
  if (mode === 'ProjectId') return record.projectId;
  if (['ServerUrl', 'Info', 'All'].includes(mode) && !serverUrl)
    throw new Error('SERVER_URL_UNAVAILABLE');
  if (mode === 'ServerUrl') return serverUrl;
  const info = `프로젝트 ID: ${record.projectId}\n서버 주소: ${serverUrl}`;
  if (mode === 'Info') return info;
  if (!['Key', 'Both', 'All'].includes(mode))
    throw new Error('INVALID_COPY_MODE');
  if (!record.recoveryKey) throw new Error('KEY_NOT_FOUND');
  if (mode === 'All') return `${info}\n복구 키: ${record.recoveryKey}`;
  if (mode === 'Both')
    return `프로젝트: ${record.projectId}\n복구 키: ${record.recoveryKey}`;
  return record.recoveryKey;
}

module.exports = { findRecoveryKeys, publicInfo, copyValue, currentServerUrl };
