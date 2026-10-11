const { app, safeStorage, clipboard } = require('electron');
const fs = require('node:fs/promises');
const { readFileSync, mkdirSync, copyFileSync } = require('node:fs');
const path = require('node:path');
const {
  findRecoveryKeys,
  publicInfo,
  copyValue,
  currentServerUrl,
} = require('./recovery-key-store.cjs');

const requestFile = process.argv[2];
let resultFile;
async function run() {
  // This setup must finish synchronously before Electron initializes OS encryption.
  const request = JSON.parse(
    readFileSync(requestFile, 'utf8').replace(/^\uFEFF/, ''),
  );
  resultFile = path.join(path.dirname(requestFile), 'result.json');
  const temporaryProfile = path.join(path.dirname(requestFile), 'profile');
  mkdirSync(temporaryProfile, { recursive: true });
  // Reuse only the OS-encrypted key. Never open/modify the running app's profile.
  copyFileSync(
    path.join(request.profile, 'Local State'),
    path.join(temporaryProfile, 'Local State'),
  );
  app.setPath('userData', temporaryProfile);
  app.setPath('sessionData', temporaryProfile);
  await app.whenReady();
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('ENCRYPTION_UNAVAILABLE');
  const records = await findRecoveryKeys(
    request.profile,
    request.stateDirectory,
    (bytes) => safeStorage.decryptString(bytes),
    { includeUnavailable: true },
  );
  if (!records.length) throw new Error('PROJECT_NOT_FOUND');
  const serverUrl = await currentServerUrl(request.stateDirectory);
  const result = {
    ok: true,
    projects: records.map(publicInfo),
    serverUrl,
    copied: false,
  };
  if (request.mode !== 'List') {
    // Re-read and validate the key for every copy, so a previous list cannot copy a rotated key.
    clipboard.writeText(
      copyValue(records, request.projectId, request.mode, serverUrl),
    );
    result.copied = true;
  }
  await fs.writeFile(resultFile, JSON.stringify(result));
}
run()
  .then(() => app.exit(0))
  .catch(async (error) => {
    const allowed = [
      'KEY_NOT_FOUND',
      'ENCRYPTION_UNAVAILABLE',
      'INVALID_COPY_MODE',
      'PROJECT_NOT_FOUND',
      'SERVER_URL_UNAVAILABLE',
    ];
    const code = allowed.includes(error.message)
      ? error.message
      : 'RECOVERY_READ_FAILED';
    if (resultFile)
      await fs
        .writeFile(resultFile, JSON.stringify({ ok: false, code }))
        .catch(() => {});
    app.exit(1);
  });
