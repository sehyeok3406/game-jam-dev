import fs from 'node:fs/promises';
import { requireProjectLayoutSupport } from '../../adapters/http/project-layout-support.ts';
import { requireProjectNamesSupport } from '../../adapters/http/project-names-support.ts';
import { PROJECT_LAYOUT_PATH } from '../../contracts/project-layout.ts';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import {
  CollaborationClient,
  serverAddress,
} from '../../collaboration-client.ts';
import type { CollaborationCredentials } from '../../collaboration-client.ts';
import type { CollaborationEnvelope } from '../../contracts/collaboration.ts';
import type {
  CreateProjectInput,
  CreationIdentity,
  LocalConversionInput,
} from '../../contracts/project-mode.ts';
import type { Snapshot } from '../../contracts/project.ts';
import type { ProjectLibrary } from '../../project-library.ts';
import type { DesktopProjectSessions } from '../project-session.ts';
import type { ConnectionOffer } from '../../application/ports/collaboration-session.ts';
import { ProjectModeService } from '../../application/projects/project-mode-service.ts';
import {
  ProjectModeFiles,
  snapshotFingerprint,
} from '../../adapters/filesystem/project-mode-files.ts';
import type { LocalAttempt } from '../../adapters/filesystem/project-mode-files.ts';
import { initialProjectSnapshot } from '../../core/projects/initial-project.ts';
import { projectDirectoryName } from '../../core/projects/project-name.ts';
import matter from '../../markdown.ts';
import { captureProject } from '../../project-store.ts';
import type { CollaborationSessionStore } from '../collaboration/session-store.ts';

type Creation = {
  identity: CreationIdentity;
  serverUrl: string;
  serverKey: string;
  internal: boolean;
  nickname: string;
  name: string;
  files: Snapshot;
  libraryId: string;
  localRoot: string | null;
  credentials?: CollaborationCredentials;
};
type Ports = {
  sessions: DesktopProjectSessions<CollaborationClient>;
  library(): ProjectLibrary;
  files(): ProjectModeFiles;
  store(): CollaborationSessionStore;
  prepare(): Promise<void>;
  busy(): boolean;
  creation(input: {
    serverUrl: string;
    serverKey: string;
  }): Promise<{ key: string; internal: boolean }>;
  chooseParent(): Promise<string | null>;
  internalServerUrl?(): Promise<string>;
  attach(
    credentials: CollaborationCredentials,
    localRoot: string | null,
  ): Promise<import('../../contracts/collaboration.ts').CollaborationState>;
  openLocal(
    root: string,
  ): Promise<import('../../contracts/project.ts').WorkspaceState>;
  changed(): void;
};
const secret = () => randomBytes(32).toString('hex');
const createKey = (source: string) =>
  'create-' + createHash('sha256').update(source).digest('hex');
/** Desktop credentials and durable file preparation implement the application transition ports. */
export class DesktopProjectModes {
  private ports: Ports;
  constructor(ports: Ports) {
    this.ports = ports;
  }
  private ready() {
    const p = this.ports,
      client = p.sessions.client;
    if (p.busy()) throw Error('AI 작업을 완료하거나 중지한 뒤 전환해주세요.');
    if (!client || !client.state.connected || client.state.accessDenied)
      throw Error('공동 서버에 연결한 뒤 전환해주세요.');
    if (client.offline || client.outgoing || client.state.pendingChanges)
      throw Error('미동기화 작업을 반영하고 충돌을 해결한 뒤 전환해주세요.');
    if (client.state.projectModeVersion !== 1)
      throw Error('프로젝트 전환을 지원하는 서버로 업데이트해주세요.');
    return client;
  }
  private async createRemote(key: string, attempt: Creation) {
    const p = this.ports;
    await requireProjectNamesSupport(serverAddress(attempt.serverUrl));
    if (attempt.files[PROJECT_LAYOUT_PATH])
      await requireProjectLayoutSupport(serverAddress(attempt.serverUrl));
    const result = (await CollaborationClient.fetch(
      attempt.serverUrl,
      '/projects-mode',
      {
        projectModeVersion: 1,
        creation: attempt.identity,
        nickname: attempt.nickname,
        name: attempt.name,
        files: attempt.files,
        drawingTextVersion: 1,
        drawingTextAlignmentVersion: 1,
        drawingEraseVersion: 1,
      },
      '',
      attempt.serverKey,
    )) as CollaborationEnvelope;
    if (result.state.projectModeVersion !== 1 || !result.state.projectId)
      throw Error('프로젝트 전환을 지원하는 서버로 업데이트해주세요.');
    attempt.credentials = {
      serverUrl: attempt.serverUrl,
      projectId: result.state.projectId,
      token: attempt.identity.token,
      inviteCode: attempt.identity.inviteCode.toUpperCase(),
      recoveryKey: attempt.identity.recoveryKey,
      internalServer: attempt.internal,
      libraryId: attempt.libraryId,
      localFingerprint: attempt.localRoot
        ? snapshotFingerprint(attempt.files)
        : undefined,
    };
    await p.files().write(key, attempt);
    await p
      .library()
      .rememberShared(
        attempt.credentials,
        result.state.projectName ?? attempt.name,
        result.state.role,
        attempt.localRoot,
      );
    await p.library().markTransition(attempt.libraryId, false);
    return attempt.credentials;
  }
  async createSource(
    input: { serverUrl: string; serverKey: string; nickname: string },
    source: { name: string; files: Snapshot },
    root: string | null,
    requestId?: string,
  ): Promise<ConnectionOffer> {
    const p = this.ports;
    p.library().assertSecureSession();
    const url = serverAddress(input.serverUrl);
    const key = createKey(url + ':' + (root ?? requestId ?? randomUUID()));
    let attempt = await p.files().read<Creation>(key);
    if (!attempt) {
      p.library().assertNameAvailable(
        source.name,
        root ? p.library().findRoot(root)?.id : undefined,
      );
      if (root) await p.library().rememberLocal(root, source.name);
      const creation = await p.creation({
        serverUrl: url,
        serverKey: input.serverKey,
      });
      attempt = {
        identity: {
          id: randomUUID(),
          token: secret(),
          recoveryKey: secret(),
          inviteCode: randomBytes(10).toString('hex'),
        },
        serverUrl: url,
        serverKey: creation.key,
        internal: creation.internal,
        nickname: input.nickname,
        name: projectDirectoryName(source.name),
        files: source.files,
        libraryId: root ? p.library().findRoot(root)!.id : randomUUID(),
        localRoot: root,
      };
      await p.files().write(key, attempt);
    }
    if (root) await p.library().markTransition(attempt.libraryId, true);
    let credentials: CollaborationCredentials;
    try {
      credentials =
        attempt.credentials ?? (await this.createRemote(key, attempt));
    } catch (error) {
      // A definite rejection has no remote commit. Transport/5xx failures stay recoverable.
      if (
        [400, 401, 403, 404, 413].includes(
          Number((error as { status?: number }).status),
        )
      ) {
        await p.files().remove(key);
        if (root) await p.library().markTransition(attempt.libraryId, false);
      }
      if (
        ![400, 401, 403, 404, 413].includes(
          Number((error as { status?: number }).status),
        )
      ) {
        await p.sessions.activate(null);
        p.sessions.localRootBeforeShare = null;
        p.changed();
      }
      throw error;
    }
    const saved = attempt;
    return {
      retain: async () => {
        await p
          .library()
          .rememberShared(credentials, saved.name, 'admin', root);
      },
      activate: async () => {
        const state = await p.attach(credentials, root);
        await p.files().remove(key);
        return state;
      },
    };
  }
  async createDirect(input: CreateProjectInput) {
    const p = this.ports;
    if (p.busy()) throw Error('AI 작업을 완료하거나 중지한 뒤 생성해주세요.');
    if (!input.requestId || !/^[a-f0-9-]{36}$/.test(input.requestId))
      throw Error('프로젝트 생성 작업 ID가 필요합니다.');
    const offer = await this.createSource(
      {
        serverUrl: input.serverUrl ?? '',
        serverKey: input.serverKey ?? '',
        nickname: input.nickname ?? '',
      },
      { name: input.name, files: initialProjectSnapshot(input.name) },
      null,
      input.requestId,
    );
    await offer.activate(null);
    return {
      root: p.sessions.root,
      name: input.name,
      session: p.sessions.ref ?? undefined,
    };
  }
  async handover(
    action: 'prepare' | 'accept' | 'cancel',
    successorId?: string,
  ) {
    const p = this.ports,
      client = this.ready();
    if (action === 'accept') {
      const id = client.state.handover?.id;
      if (!id || client.state.handover?.to !== client.state.memberId)
        throw Error('내게 온 소유권 인계 요청이 없습니다.');
      const recoveryKey =
        client.credentials.pendingHandoverId === id &&
        client.credentials.recoveryKey
          ? client.credentials.recoveryKey
          : secret();
      // Safe local persistence precedes activation of the new recovery key.
      client.credentials.recoveryKey = recoveryKey;
      client.credentials.pendingHandoverId = id;
      await p
        .library()
        .rememberShared(
          client.credentials,
          client.state.projectName!,
          client.state.role,
          p.sessions.localRootBeforeShare,
        );
      await p.store().save({
        credentials: client.credentials,
        localRoot: p.sessions.localRootBeforeShare,
      });
      await client.handover('accept', { id, recoveryKey });
    } else await client.handover(action, { successorId });
    p.changed();
  }
  async toLocal(input: LocalConversionInput) {
    const p = this.ports;
    await p.prepare();
    const client = this.ready(),
      ref = p.sessions.ref;
    const entry = p
      .library()
      .findShared(client.credentials.projectId, client.credentials.serverUrl);
    // A previous ambiguous server response must be resolved before capturing another attempt.
    await this.recover(entry.id);
    if (p.library().get(entry.id).kind === 'local') {
      await p.openLocal(p.library().get(entry.id).root!);
      return;
    }
    const service = new ProjectModeService({
      assertReady: () => {
        p.sessions.assertCurrent(ref);
        this.ready();
      },
      prepare: async () => {
        const snapshot = await client.modeSnapshot();
        if (snapshot.files['project.md']) {
          const document = matter(snapshot.files['project.md']);
          if (
            document.data.project_name !== snapshot.name ||
            document.data.title !== snapshot.name
          ) {
            document.data.project_name = snapshot.name;
            document.data.title = snapshot.name;
            snapshot.files['project.md'] = matter.stringify(
              document.content,
              document.data,
            );
            if (snapshot.authorship['project.md']) {
              snapshot.authorship['project.md'] = {
                ...snapshot.authorship['project.md'],
                contentHash: createHash('sha256')
                  .update(snapshot.files['project.md'])
                  .digest('hex'),
                lastEditedBy: { kind: 'local', name: '로컬 사용자' },
                lastEditedAt: Date.now(),
              };
            }
          }
        }
        p.sessions.assertCurrent(ref);
        p.library().assertNameAvailable(snapshot.name, entry.id);
        let target: string;
        if (input.parent)
          target = path.join(
            await fs.realpath(input.parent),
            projectDirectoryName(snapshot.name),
          );
        else if (entry.localRoot) target = entry.localRoot;
        else {
          const parent = await p.chooseParent();
          p.sessions.assertCurrent(ref);
          if (!parent) throw Error('로컬 전환을 취소했습니다.');
          target = path.join(
            await fs.realpath(parent),
            projectDirectoryName(snapshot.name),
          );
        }
        const exists = await fs.stat(target).then(
          () => true,
          (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return false;
            throw error;
          },
        );
        if (exists && target.toLowerCase() !== entry.localRoot?.toLowerCase())
          throw Error(
            '같은 이름의 폴더가 이미 있습니다. 다른 저장 위치를 선택해주세요.',
          );
        const before = exists ? await captureProject(target) : {};
        if (
          exists &&
          (!client.credentials.localFingerprint ||
            snapshotFingerprint(before) !== client.credentials.localFingerprint)
        )
          throw Error(
            '기존 로컬 폴더가 외부에서 변경되었습니다. 자료를 보존하려면 다른 저장 위치를 선택해주세요.',
          );
        if (!exists) await fs.mkdir(target);
        const attempt: LocalAttempt = {
          ...snapshot,
          id: randomUUID(),
          libraryId: entry.id,
          target,
          before,
          proof: secret(),
          successorId: input.successorId,
          credentials: { ...client.credentials },
          committed: false,
        };
        await p.files().prepare(attempt);
        await p.library().markTransition(entry.id, true);
        return {
          commitRemote: async () => {
            try {
              await client.request('detach', {
                id: attempt.id,
                proof: attempt.proof,
                stamp: attempt.stamp,
                successorId: attempt.successorId,
              });
            } catch (error) {
              if (
                [400, 403, 409].includes(
                  Number((error as { status?: number }).status),
                )
              ) {
                await p.files().remove('local-' + attempt.id);
                await p.library().markTransition(entry.id, false);
                if (!exists) await fs.rmdir(target).catch(() => {});
              } else {
                client.stop();
                await p.sessions.activate(null);
                p.sessions.localRootBeforeShare = null;
                p.changed();
              }
              throw error;
            }
            attempt.committed = true;
            await p.files().write('local-' + attempt.id, attempt);
          },
          finishLocal: async () => {
            client.stop();
            await p.sessions.activate(null);
            p.sessions.localRootBeforeShare = null;
            await this.finish(attempt);
            await p.openLocal(attempt.target);
          },
        };
      },
    });
    await service.toLocal(input);
  }
  private async finish(attempt: LocalAttempt) {
    const p = this.ports;
    await p.files().finish(attempt);
    await p
      .library()
      .makeLocal(attempt.libraryId, attempt.target, attempt.name);
    const stored = await p
      .store()
      .read()
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    if (stored?.credentials?.projectId === attempt.credentials.projectId)
      await p.store().save({ credentials: null, localRoot: null });
    await p.files().remove('local-' + attempt.id);
    p.changed();
  }
  async recover(libraryId?: string) {
    const p = this.ports;
    for (const key of await p.files().ids('local-')) {
      const attempt = (await p.files().read<LocalAttempt>(key))!;
      if (libraryId && attempt.libraryId !== libraryId) continue;
      if (!attempt.committed) {
        if (attempt.credentials.internalServer && p.internalServerUrl) {
          attempt.credentials.serverUrl = await p.internalServerUrl();
          await p.files().write(key, attempt);
        }
        const result = (await CollaborationClient.fetch(
          attempt.credentials.serverUrl,
          '/projects/' + attempt.credentials.projectId + '/detach-status',
          { id: attempt.id, proof: attempt.proof },
        )) as { committed: boolean };
        if (!result.committed) {
          await p.files().remove(key);
          await p.library().markTransition(attempt.libraryId, false);
          continue;
        }
        attempt.committed = true;
        await p.files().write(key, attempt);
      }
      await this.finish(attempt);
    }
    for (const key of await p.files().ids('create-')) {
      const attempt = (await p.files().read<Creation>(key))!;
      if (libraryId && attempt.libraryId !== libraryId) continue;
      if (attempt.internal && p.internalServerUrl) {
        attempt.serverUrl = await p.internalServerUrl();
        attempt.serverKey = (
          await p.creation({ serverUrl: attempt.serverUrl, serverKey: '' })
        ).key;
        if (attempt.credentials)
          attempt.credentials.serverUrl = attempt.serverUrl;
        await p.files().write(key, attempt);
      }
      if (!attempt.credentials) await this.createRemote(key, attempt);
      else
        await p
          .library()
          .rememberShared(
            attempt.credentials,
            attempt.name,
            'admin',
            attempt.localRoot,
          );
      await p.library().markTransition(attempt.libraryId, false);
      await p.files().remove(key);
    }
  }
}
