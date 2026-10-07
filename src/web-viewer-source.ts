import fs from 'node:fs/promises';
import path from 'node:path';
import { CollaborationClient } from './collaboration-client.ts';
import type { CollaborationCredentials } from './collaboration-client.ts';
import type { CollaborationEnvelope } from './collaboration-server.ts';
import { checkSnapshot } from './collaboration-model.ts';
import type { Snapshot } from './project-store.ts';

type WebSharedSnapshot = {
  files: Snapshot;
  state: { projectId: string; projectName: string; revision: number };
};

// The administrator PC already owns the server's persisted project files. Read
// the selected project's atomic checkpoint as a local publication source, without
// rotating collaboration sessions or exporting the checkpoint's authentication data.
async function hostedSnapshot(
  directory: string | undefined,
  projectId: string,
): Promise<WebSharedSnapshot | null> {
  if (!directory || !/^[a-f0-9-]{36}$/.test(projectId)) return null;
  try {
    const root = path.join(directory, 'projects', projectId);
    const head = JSON.parse(
      await fs.readFile(path.join(root, 'head.json'), 'utf8'),
    );
    if (!/^[a-f0-9-]{36}$/.test(head.checkpoint)) return null;
    const saved = JSON.parse(
      await fs.readFile(
        path.join(root, 'checkpoints', head.checkpoint, 'state.json'),
        'utf8',
      ),
    );
    if (
      saved.id !== projectId ||
      typeof saved.name !== 'string' ||
      !Number.isSafeInteger(saved.revision) ||
      saved.revision < 0
    )
      return null;
    checkSnapshot(saved.files);
    return {
      files: saved.files,
      state: { projectId, projectName: saved.name, revision: saved.revision },
    };
  } catch {
    return null;
  }
}

// A PC-hosted project's publisher need not depend on a temporary public tunnel.
// Only use the recorded loopback host for projects actually stored by this host;
// the normal project token and returned project identity must still match.
async function localAddress(directory: string | undefined, projectId: string) {
  if (!directory || !/^[a-f0-9-]{36}$/.test(projectId)) return null;
  try {
    const head = JSON.parse(
      await fs.readFile(
        path.join(directory, 'projects', projectId, 'head.json'),
        'utf8',
      ),
    );
    if (!/^[a-f0-9-]{36}$/.test(head.checkpoint)) return null;
    const runtime = JSON.parse(
      (await fs.readFile(path.join(directory, 'runtime.json'), 'utf8')).replace(
        /^\uFEFF/,
        '',
      ),
    );
    const url = new URL(runtime.localUrl);
    return url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

export async function webSharedProject(
  credentials: CollaborationCredentials,
  hostDirectory = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'GameCanvas-InternetHost')
    : undefined,
  readAdministratorHostFiles = false,
): Promise<WebSharedSnapshot> {
  if (readAdministratorHostFiles) {
    const saved = await hostedSnapshot(hostDirectory, credentials.projectId);
    if (saved) return saved;
  }
  const local = await localAddress(hostDirectory, credentials.projectId);
  const addresses = [
    ...new Set(
      [local, credentials.serverUrl].filter(
        (value): value is string => !!value,
      ),
    ),
  ];
  for (const address of addresses) {
    try {
      const envelope = (await CollaborationClient.fetch(
        address,
        `/projects/${credentials.projectId}/state`,
        {},
        credentials.token,
      )) as CollaborationEnvelope;
      if (
        envelope.state?.projectId !== credentials.projectId ||
        !envelope.files
      )
        throw new Error('Project identity mismatch');
      checkSnapshot(envelope.files);
      return {
        files: envelope.files,
        state: {
          projectId: credentials.projectId,
          projectName: envelope.state.projectName ?? '',
          revision: envelope.state.revision ?? 0,
        },
      };
    } catch {
      // Try the saved public address if the local host is unavailable.
    }
  }
  throw new Error('공동 프로젝트 서버에 연결하지 못했습니다.');
}
