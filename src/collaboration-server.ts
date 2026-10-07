import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from './markdown.ts';
import { isAiProvider } from './ai-providers.ts';
import {
  checkSnapshot,
  collaborationPath,
  commandLabels,
  reduceCollaboration,
} from './collaboration-model.ts';
import { expectedArtifacts, validateArtifacts } from './ai-artifacts.ts';
import { newOutputsAlreadyExist, workflowStages } from './task-plan.ts';
import { validateHtmlAnalysis } from './html-source.ts';
import { taskHistoryRecord, withTaskHistory } from './ai-task-history.ts';
import { historyTaskPath } from './ai-task-records.ts';
import {
  CanvasError,
  ERROR_CODES,
  failureInfo,
  errorText,
  type ErrorCode,
} from './app-errors.ts';
import { materialize, type Snapshot } from './project-store.ts';
import { isAssetPath } from './file-assets.ts';
import { isImportedPreviewPath } from './preview-output.ts';
import { invertEdit } from './edit-journal.ts';
import { homeName } from './home-organization.ts';
import { advanceAuthorship, rebuildAuthorship } from './file-authorship.ts';
import type {
  CollaborationRole,
  CollaborationState,
  CodexRunEvent,
  HistoryEntry,
  FileAuthorshipMap,
} from './shared.ts';

type Member = {
  id: string;
  nickname: string;
  role: CollaborationRole;
  owner: boolean;
  tokenHash: string;
  removed?: boolean;
};
type StoredHistory = { entry: HistoryEntry; before: Snapshot; after: Snapshot };
type Job = {
  providerId?: import('./shared.ts').AiProviderId;
  startedAt?: number;
  modelId?: string | null;
  id: string;
  memberId: string;
  taskPath: string;
  outputs: string[];
  revision: number;
  baselineHash: string;
  expiresAt: number;
  event: CodexRunEvent;
};
type Project = {
  id: string;
  name: string;
  createdAt?: number;
  modifiedAt?: number;
  revision: number;
  files: Snapshot;
  revisions: Record<string, number>;
  members: Member[];
  inviteHash: string;
  inviteExpiresAt: number;
  recoveryHash: string;
  history: StoredHistory[];
  applied: { id: string; memberId: string; result: unknown }[];
  job: Job | null;
  lastRun: CodexRunEvent | null;
  authorship: FileAuthorshipMap;
};
type Lock = { memberId: string; token: string; expiresAt: number };
export type CollaborationCommand = {
  id: string;
  channel: string;
  input: unknown;
  revisions: Record<string, number>;
  lockToken?: string;
};
export type CollaborationEnvelope = {
  state: CollaborationState;
  files: Snapshot;
  revisions: Record<string, number>;
  authorship?: FileAuthorshipMap;
};
type Options = {
  dataDirectory: string;
  host?: string;
  port?: number;
  creationKey?: string;
  /** Required even on loopback when the server is published through a tunnel. */
  publicAccess?: boolean;
};
class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const same = (value: string, hash: string) =>
  timingSafeEqual(Buffer.from(digest(value), 'hex'), Buffer.from(hash, 'hex'));
const nickname = (value: unknown) => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 40 ||
    [...value].some((char) => char.charCodeAt(0) < 32)
  )
    throw new ApiError('닉네임은 1~40자로 입력해주세요.', 400);
  return value.trim();
};
const invite = () => randomBytes(10).toString('hex').toUpperCase();
const role = (value: unknown): CollaborationRole => {
  if (!['admin', 'editor', 'viewer'].includes(value as string))
    throw new ApiError('역할이 올바르지 않습니다.', 400);
  return value as CollaborationRole;
};
const activeEvent = (event: CodexRunEvent | null) =>
  !!event && ['starting', 'running', 'validating'].includes(event.status);
const taskState = (files: Snapshot, relative: string, status: string) => {
  const parsed = matter(files[relative]);
  return {
    ...files,
    [relative]: matter.stringify(parsed.content, {
      ...parsed.data,
      status,
      ai_updated_at: new Date().toISOString(),
    }),
  };
};

/** Small-group server. Durable commits use an immutable checkpoint plus an atomic head pointer. */
export async function createCollaborationServer(options: Options) {
  const host = options.host ?? '127.0.0.1';
  if (
    (options.publicAccess ||
      !['127.0.0.1', '::1', 'localhost'].includes(host)) &&
    (options.creationKey?.length ?? 0) < 32
  )
    throw new Error('외부 연결 서버에는 32자 이상의 creationKey가 필요합니다.');
  const root = path.resolve(options.dataDirectory);
  await fs.mkdir(root, { recursive: true });
  const projects = new Map<string, Project>();
  const queues = new Map<string, Promise<unknown>>();
  const locks = new Map<string, Map<string, Lock>>();
  const online = new Map<string, Map<string, number>>();
  const rates = new Map<string, { count: number; until: number }>();
  const queue = <T>(id: string, operation: () => Promise<T>): Promise<T> => {
    const next = (queues.get(id) ?? Promise.resolve()).then(operation);
    queues.set(
      id,
      next.catch(() => undefined),
    );
    return next;
  };
  const persist = async (project: Project) => {
    const folder = path.join(root, project.id),
      checkpoint = randomUUID();
    const target = path.join(folder, 'checkpoints', checkpoint);
    await fs.mkdir(target, { recursive: true });
    await fs.mkdir(path.join(target, 'files'), { recursive: true });
    await materialize(path.join(target, 'files'), project.files);
    await fs.writeFile(
      path.join(target, 'state.json'),
      JSON.stringify(project),
      { mode: 0o600 },
    );
    const temporary = path.join(folder, `head-${checkpoint}.tmp`);
    await fs.writeFile(temporary, JSON.stringify({ checkpoint }), {
      mode: 0o600,
    });
    await fs.rename(temporary, path.join(folder, 'head.json'));
    projects.set(project.id, project);
  };
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue;
    try {
      const head = JSON.parse(
        await fs.readFile(path.join(root, entry.name, 'head.json'), 'utf8'),
      );
      if (!/^[a-f0-9-]{36}$/.test(head.checkpoint))
        throw new Error('Invalid checkpoint');
      const project: Project = JSON.parse(
        await fs.readFile(
          path.join(
            root,
            entry.name,
            'checkpoints',
            head.checkpoint,
            'state.json',
          ),
          'utf8',
        ),
      );
      checkSnapshot(project.files);
      project.authorship ??= rebuildAuthorship(project.history);
      const directory = await fs.stat(path.join(root, entry.name));
      project.createdAt ??=
        directory.birthtimeMs > 0 ? directory.birthtimeMs : undefined;
      project.modifiedAt ??=
        project.history.at(-1)?.entry.finishedAt ??
        project.history.at(-1)?.entry.createdAt ??
        project.createdAt;
      if (project.job) {
        project.job.expiresAt = 0;
      }
      projects.set(project.id, project);
    } catch (error) {
      throw new Error(`협업 프로젝트 복구 실패: ${entry.name}`, {
        cause: error,
      });
    }
  }
  const projectLocks = (id: string) => {
    let map = locks.get(id);
    if (!map) locks.set(id, (map = new Map()));
    for (const [relative, lock] of map)
      if (lock.expiresAt < Date.now()) map.delete(relative);
    return map;
  };
  const authenticate = (project: Project, token: string) => {
    const member = project.members.find(
      (member) => !member.removed && same(token, member.tokenHash),
    );
    if (!member)
      throw new ApiError(
        '참여 권한이 없거나 회수되었습니다. 코드를 통해 다시 참여해주세요.',
        403,
      );
    let map = online.get(project.id);
    if (!map) online.set(project.id, (map = new Map()));
    map.set(member.id, Date.now());
    return member;
  };
  const admin = (member: Member) => {
    if (member.role !== 'admin')
      throw new ApiError('관리자만 사용할 수 있는 기능입니다.', 403);
  };
  const editable = (project: Project, member: Member) => {
    if (member.role === 'viewer')
      throw new ApiError('뷰어는 문서를 편집할 수 없습니다.', 403);
    if (project.job)
      throw new ApiError(
        '현재 AI 작업이 진행 중입니다. 문서 편집이 잠겨 있습니다.',
      );
  };
  const envelope = (
    project: Project,
    member: Member,
  ): CollaborationEnvelope => ({
    files: project.files,
    revisions: project.revisions,
    authorship: project.authorship,
    state: {
      active: true,
      connected: true,
      offlineSync: true,
      projectRename: true,
      taskInstructionsEditable: true,
      taskResultNaming: true,
      gamejamWorkflow: true,
      htmlImportAnalysis: true,
      htmlResultFolders: true,
      editorAi: true,
      multiProviderAi: true,
      projectId: project.id,
      projectName: project.name,
      projectCreatedAt: project.createdAt,
      projectModifiedAt: project.modifiedAt,
      memberId: member.id,
      role: member.role,
      revision: project.revision,
      members: project.members
        .filter((member) => !member.removed)
        .map((member) => ({
          id: member.id,
          nickname: member.nickname,
          role: member.role,
          owner: member.owner,
          online:
            (online.get(project.id)?.get(member.id) ?? 0) > Date.now() - 12_000,
        })),
      locks: [...projectLocks(project.id)].map(([relativePath, lock]) => ({
        relativePath,
        memberId: lock.memberId,
        nickname:
          project.members.find((member) => member.id === lock.memberId)
            ?.nickname ?? '참여자',
      })),
      aiRun: project.job?.event ?? project.lastRun,
      inviteExpiresAt:
        member.role === 'admin' ? project.inviteExpiresAt : undefined,
    },
  });
  const recordChanges = (
    project: Project,
    member: Member,
    after: Snapshot,
    label: string,
    kind: HistoryEntry['kind'] = 'user',
    extra: Partial<HistoryEntry> = {},
  ) => {
    const touched = Object.keys({ ...project.files, ...after }).filter(
      (relative) => project.files[relative] !== after[relative],
    );
    const beforeFiles: Snapshot = {},
      afterFiles: Snapshot = {};
    for (const relative of touched) {
      if (project.files[relative] !== undefined)
        beforeFiles[relative] = project.files[relative];
      if (after[relative] !== undefined) afterFiles[relative] = after[relative];
      project.revisions[relative] = (project.revisions[relative] ?? 0) + 1;
    }
    project.revision++;
    project.modifiedAt = Date.now();
    project.history.push({
      entry: withTaskHistory(
        {
          id: randomUUID(),
          label,
          kind,
          status: 'completed',
          createdAt: Date.now(),
          finishedAt: Date.now(),
          actorId: member.id,
          actorName: member.nickname,
          action: label,
          revision: project.revision,
          files: touched.map((relativePath) => ({
            relativePath,
            before: beforeFiles[relativePath] !== undefined,
            after: afterFiles[relativePath] !== undefined,
          })),
          ...extra,
        },
        project.files,
        after,
      ),
      before: beforeFiles,
      after: afterFiles,
    });
    project.authorship = advanceAuthorship(
      project.authorship,
      beforeFiles,
      afterFiles,
      {
        ...project.history.at(-1)!.entry,
        // Failed AI runs may still commit a task status, but never their outputs.
        status: 'completed',
      },
    );
    project.history = project.history.slice(-300);
    project.files = after;
  };
  const assertBases = (
    project: Project,
    before: Snapshot,
    after: Snapshot,
    bases: Record<string, number>,
    member: Member,
  ) => {
    for (const relative of Object.keys({ ...before, ...after }).filter(
      (relative) => before[relative] !== after[relative],
    )) {
      if ((bases?.[relative] ?? 0) !== (project.revisions[relative] ?? 0))
        throw new ApiError(
          `다른 참여자가 변경했습니다. 최신 내용을 확인하고 다시 시도해주세요: ${relative}`,
        );
      const lock = projectLocks(project.id).get(relative);
      if (lock && lock.memberId !== member.id)
        throw new ApiError(`다른 참여자가 편집 중입니다: ${relative}`);
      if (
        member.role !== 'admin' &&
        relative.startsWith('.ai/tasks/') &&
        before[relative] !== undefined
      )
        throw new ApiError('AI 작업 문서는 관리자만 변경할 수 있습니다.', 403);
    }
  };
  const expireJob = async (project: Project) => {
    if (!project.job || project.job.expiresAt > Date.now()) return project;
    const next = structuredClone(project),
      job = next.job!;
    const member = next.members.find((member) => member.id === job.memberId)!;
    next.lastRun = {
      ...job.event,
      status: 'failed',
      kind: 'error',
      message: 'AI 실행기 연결이 종료되어 결과를 반영하지 않았습니다.',
      timestamp: Date.now(),
    };
    recordChanges(
      next,
      member,
      taskState(next.files, job.taskPath, 'failed'),
      'AI 실행기 연결 종료',
      'ai',
      {
        status: 'failed',
        taskPath: job.taskPath,
        error: next.lastRun.message,
        modelId: job.modelId,
        providerId: job.providerId ?? 'codex-cli',
        createdAt: job.startedAt ?? job.event.timestamp,
      },
    );
    next.job = null;
    await persist(next);
    return next;
  };
  const body = async (
    request: IncomingMessage,
  ): Promise<Record<string, unknown>> => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += Buffer.byteLength(chunk);
      if (size > 22_000_000) throw new ApiError('요청이 너무 큽니다.', 413);
      chunks.push(Buffer.from(chunk));
    }
    try {
      // TCP/tunnel chunks may split a Korean character between buffers.
      const raw = Buffer.concat(chunks).toString('utf8');
      const parsed = JSON.parse(raw || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error();
      return parsed;
    } catch {
      throw new ApiError('요청 형식이 올바르지 않습니다.', 400);
    }
  };
  const limit = (identity: string, category: string, max: number) => {
    const key = `${identity}:${category}`;
    for (const [key, value] of rates)
      if (value.until < Date.now()) rates.delete(key);
    if (!rates.has(key) && rates.size >= 10_000)
      throw new ApiError('서버가 혼잡합니다. 잠시 후 다시 시도해주세요.', 429);
    const current = rates.get(key);
    const value =
      current && current.until > Date.now()
        ? current
        : { count: 0, until: Date.now() + 60_000 };
    rates.set(key, value);
    if (++value.count > max)
      throw new ApiError(
        '입력 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.',
        429,
      );
  };
  const reply = (response: ServerResponse, status: number, value: unknown) => {
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(JSON.stringify(value));
  };
  const server = http.createServer(async (request, response) => {
    try {
      // Desktop transport only: reject browser cross-origin requests, including form POSTs.
      if (request.headers.origin)
        throw new ApiError('초기 서버는 데스크톱 앱 연결만 지원합니다.', 403);
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/health') {
        reply(response, 200, {
          name: 'Game Canvas Collaboration',
          protocol: 1,
          taskInstructionsEditable: true,
          taskResultNaming: true,
          gamejamWorkflow: true,
          htmlImportAnalysis: true,
          htmlResultFolders: true,
        });
        return;
      }
      if (request.method !== 'POST')
        throw new ApiError('지원하지 않는 요청입니다.', 404);
      // Do not trust client-supplied proxy headers. A tunnel shares one peer IP,
      // so authenticated traffic is limited by real server-side member identity.
      const peer = request.socket.remoteAddress ?? 'unknown';
      const match = /^\/projects\/([a-f0-9-]{36})\/([a-z-]+)$/.exec(
        url.pathname,
      );
      if (url.pathname === '/projects') {
        limit(peer, 'create', 10);
        if (
          options.creationKey &&
          !same(
            String(request.headers['x-server-key'] ?? ''),
            digest(options.creationKey),
          )
        )
          throw new ApiError('서버 생성 키가 올바르지 않습니다.', 403);
      } else if (url.pathname === '/join') {
        limit(peer, 'join', 20);
      } else if (url.pathname === '/recover') {
        limit(peer, 'recover', 10);
      } else if (match) {
        // Aggregate ingress protection leaves room for 20 members at 0.9s polls.
        limit(peer, 'project-ingress', 2400);
        const project = projects.get(match[1]);
        if (!project) throw new ApiError('프로젝트를 찾을 수 없습니다.', 404);
        const member = authenticate(
          project,
          String(request.headers.authorization ?? '').replace(/^Bearer /, ''),
        );
        limit(`${project.id}:${member.id}`, 'member', 600);
      } else {
        limit(peer, 'unknown-route', 30);
        throw new ApiError('경로를 찾을 수 없습니다.', 404);
      }
      const input = await body(request);
      if (url.pathname === '/projects') {
        if (projects.size >= 20)
          throw new ApiError(
            '초기 서버는 프로젝트를 20개까지 지원합니다.',
            413,
          );
        checkSnapshot(input.files);
        const code = invite(),
          token = secret(),
          recoveryKey = secret(),
          name = nickname(input.name);
        const member: Member = {
          id: randomUUID(),
          nickname: nickname(input.nickname),
          role: 'admin',
          owner: true,
          tokenHash: digest(token),
        };
        const project: Project = {
          id: randomUUID(),
          name,
          createdAt: Date.now(),
          modifiedAt: Date.now(),
          files: input.files,
          revision: 1,
          revisions: Object.fromEntries(
            Object.keys(input.files).map((key) => [key, 1]),
          ),
          members: [member],
          inviteHash: digest(code),
          inviteExpiresAt: Date.now() + 24 * 60 * 60_000,
          recoveryHash: digest(recoveryKey),
          history: [],
          applied: [],
          job: null,
          lastRun: null,
          authorship: {},
        };
        await persist(project);
        authenticate(project, token);
        reply(response, 200, {
          ...envelope(project, member),
          token,
          code,
          recoveryKey,
        });
        return;
      }
      if (url.pathname === '/join') {
        const code = String(input.code ?? '')
          .replace(/[\s-]/g, '')
          .toUpperCase();
        const found = [...projects.values()].find(
          (project) =>
            project.inviteExpiresAt > Date.now() &&
            same(code, project.inviteHash),
        );
        if (!found)
          throw new ApiError('초대 코드가 없거나 만료되었습니다.', 403);
        const result = await queue(found.id, async () => {
          const project = structuredClone(projects.get(found.id)!);
          if (
            project.inviteExpiresAt < Date.now() ||
            !same(code, project.inviteHash)
          )
            throw new ApiError('초대 코드가 만료되거나 변경되었습니다.', 403);
          if (project.members.filter((member) => !member.removed).length >= 20)
            throw new ApiError(
              '초기 프로젝트는 최대 20명이 참여할 수 있습니다.',
              413,
            );
          const token = secret(),
            member: Member = {
              id: randomUUID(),
              nickname: nickname(input.nickname),
              role: 'editor',
              owner: false,
              tokenHash: digest(token),
            };
          project.members.push(member);
          await persist(project);
          authenticate(project, token);
          return { ...envelope(project, member), token };
        });
        reply(response, 200, result);
        return;
      }
      if (url.pathname === '/recover') {
        const id = String(input.projectId ?? '');
        const result = await queue(id, async () => {
          const source = projects.get(id);
          if (
            !source ||
            !same(String(input.recoveryKey ?? ''), source.recoveryHash)
          )
            throw new ApiError('복구 정보가 올바르지 않습니다.', 403);
          const project = structuredClone(source),
            owner = project.members.find((member) => member.owner)!;
          const token = secret(),
            recoveryKey = secret();
          owner.tokenHash = digest(token);
          owner.removed = false;
          owner.role = 'admin';
          project.recoveryHash = digest(recoveryKey);
          await persist(project);
          return { ...envelope(project, owner), token, recoveryKey };
        });
        reply(response, 200, result);
        return;
      }
      if (!match) throw new ApiError('경로를 찾을 수 없습니다.', 404);
      const [, id, action] = match;
      const result = await queue(id, async () => {
        let project = projects.get(id);
        if (!project) throw new ApiError('프로젝트를 찾을 수 없습니다.', 404);
        const member = authenticate(
          project,
          String(request.headers.authorization ?? '').replace(/^Bearer /, ''),
        );
        project = await expireJob(project);
        if (action === 'state') {
          for (const item of Array.isArray(input.renewLocks)
            ? input.renewLocks
            : []) {
            if (!item || typeof item !== 'object') continue;
            const { relativePath, token } = item as {
              relativePath: string;
              token: string;
            };
            const lock = projectLocks(id).get(relativePath);
            if (lock?.memberId === member.id && lock.token === token)
              lock.expiresAt = Date.now() + 30_000;
          }
          const result = envelope(project, member);
          if (input.metadataOnly === true) return { state: result.state };
          return input.knownRevision === project.revision
            ? { ...result, files: undefined, revisions: undefined }
            : result;
        }
        if (action === 'leave') {
          online.get(id)?.delete(member.id);
          for (const [relative, lock] of projectLocks(id))
            if (lock.memberId === member.id) projectLocks(id).delete(relative);
          return {};
        }
        if (action === 'lock') {
          editable(project, member);
          const relative = collaborationPath(input.relativePath);
          if (
            !project.files[relative] ||
            !relative.endsWith('.md') ||
            relative.startsWith('sections/')
          )
            throw new ApiError('편집할 문서를 찾을 수 없습니다.');
          if (relative.startsWith('.ai/tasks/')) admin(member);
          const current = projectLocks(id).get(relative);
          if (current && current.memberId !== member.id)
            throw new ApiError('다른 참여자가 이 문서를 편집 중입니다.');
          const token = current?.token ?? secret();
          projectLocks(id).set(relative, {
            token,
            memberId: member.id,
            expiresAt: Date.now() + 30_000,
          });
          return { ...envelope(project, member), lockToken: token };
        }
        if (action === 'unlock') {
          const lock = projectLocks(id).get(String(input.relativePath));
          if (lock?.memberId === member.id && lock.token === input.token)
            projectLocks(id).delete(String(input.relativePath));
          return envelope(project, member);
        }
        if (action === 'offline-sync') {
          const operationId = input.id;
          if (
            typeof operationId !== 'string' ||
            !/^[a-f0-9-]{36}$/.test(operationId)
          )
            throw new ApiError('동기화 작업 ID가 올바르지 않습니다.', 400);
          const applied = project.applied.find(
            (item) => item.id === operationId,
          );
          if (applied) {
            if (applied.memberId !== member.id)
              throw new ApiError('작업 ID가 충돌했습니다.');
            return envelope(project, member);
          }
          editable(project, member);
          if (
            !input.changes ||
            typeof input.changes !== 'object' ||
            Array.isArray(input.changes)
          )
            throw new ApiError('동기화 내용이 올바르지 않습니다.', 400);
          const nextFiles = { ...project.files };
          const changes = Object.entries(input.changes);
          if (!changes.length || changes.length > 500)
            throw new ApiError('동기화 파일 수가 올바르지 않습니다.', 400);
          for (const [key, value] of changes) {
            const relative = collaborationPath(key);
            if (
              relative.startsWith('.ai/tasks/') ||
              relative.startsWith('output/') ||
              relative.startsWith('docs/html-sources/')
            )
              throw new ApiError(
                'AI 실행 및 HTML 결과는 온라인에서만 변경할 수 있습니다.',
                403,
              );
            if (value === null) {
              delete nextFiles[relative];
            } else if (typeof value === 'string') nextFiles[relative] = value;
            else
              throw new ApiError('동기화 파일 내용이 올바르지 않습니다.', 400);
          }
          checkSnapshot(nextFiles);
          assertBases(
            project,
            project.files,
            nextFiles,
            input.revisions as Record<string, number>,
            member,
          );
          const next = structuredClone(project);
          recordChanges(next, member, nextFiles, '오프라인 작업 동기화');
          next.applied.push({
            id: operationId,
            memberId: member.id,
            result: null,
          });
          next.applied = next.applied.slice(-500);
          await persist(next);
          return envelope(next, member);
        }
        if (action === 'command') {
          const command = input as unknown as CollaborationCommand;
          if (
            typeof command.id !== 'string' ||
            !/^[a-f0-9-]{36}$/.test(command.id)
          )
            throw new ApiError('작업 ID가 올바르지 않습니다.', 400);
          const applied = project.applied.find(
            (operation) => operation.id === command.id,
          );
          if (applied) {
            if (applied.memberId !== member.id)
              throw new ApiError('작업 ID가 충돌했습니다.');
            const stored = applied.result as {
              value?: unknown;
              historyId?: string;
            } | null;
            return {
              ...envelope(project, member),
              result:
                stored && 'historyId' in stored ? stored.value : applied.result,
              historyId: stored?.historyId,
            };
          }
          editable(project, member);
          if (command.channel === 'documents:save') {
            const relative = collaborationPath(
              (command.input as { relativePath: string })?.relativePath,
            );
            const lock = projectLocks(id).get(relative);
            if (
              !lock ||
              lock.memberId !== member.id ||
              lock.token !== command.lockToken
            )
              throw new ApiError(
                '문서 편집 잠금이 만료되었습니다. 초안을 복사하고 다시 편집해주세요.',
              );
          }
          const reduced = reduceCollaboration(
            project.files,
            command.channel,
            command.input,
          );
          assertBases(
            project,
            project.files,
            reduced.files,
            command.revisions,
            member,
          );
          const next = structuredClone(project);
          recordChanges(
            next,
            member,
            reduced.files,
            commandLabels[command.channel],
          );
          next.applied.push({
            id: command.id,
            memberId: member.id,
            result: {
              value: reduced.result,
              historyId: next.history.at(-1)!.entry.files.length
                ? next.history.at(-1)!.entry.id
                : null,
            },
          });
          next.applied = next.applied.slice(-500);
          await persist(next);
          return {
            ...envelope(next, member),
            result: reduced.result,
            historyId: next.history.at(-1)!.entry.files.length
              ? next.history.at(-1)!.entry.id
              : null,
          };
        }
        if (action === 'invite') {
          admin(member);
          const next = structuredClone(project),
            code = invite();
          next.inviteHash = digest(code);
          next.inviteExpiresAt = Date.now() + 24 * 60 * 60_000;
          recordChanges(next, member, next.files, '초대 코드 재발급');
          await persist(next);
          return { ...envelope(next, member), code };
        }
        if (action === 'rename') {
          admin(member);
          editable(project, member);
          let name: string;
          try {
            name = homeName(input.name as string);
          } catch (error) {
            throw new ApiError((error as Error).message, 400);
          }
          if (typeof input.expectedName !== 'string')
            throw new ApiError('기존 프로젝트 이름을 확인해주세요.', 400);
          if (name === project.name) return envelope(project, member);
          if (input.expectedName !== project.name)
            throw new ApiError(
              '프로젝트 이름이 바뀌었습니다. 목록을 새로고침하고 다시 확인해주세요.',
              409,
            );
          const next = structuredClone(project);
          next.name = name;
          recordChanges(
            next,
            member,
            next.files,
            `프로젝트 이름 변경 · ${project.name} → ${name}`,
          );
          await persist(next);
          return envelope(next, member);
        }
        if (action === 'role') {
          admin(member);
          const next = structuredClone(project),
            target = next.members.find(
              (candidate) =>
                candidate.id === input.memberId && !candidate.removed,
            );
          if (!target) throw new ApiError('참여자를 찾을 수 없습니다.');
          if (target.owner)
            throw new ApiError(
              '프로젝트 생성자의 관리자 권한은 회수할 수 없습니다.',
            );
          if (project.job && project.job.memberId === target.id)
            throw new ApiError(
              'AI 실행 중에는 실행자의 역할을 변경할 수 없습니다. 먼저 작업을 중지해주세요.',
            );
          if (input.role === 'removed') target.removed = true;
          else target.role = role(input.role);
          for (const [relative, lock] of projectLocks(id))
            if (lock.memberId === target.id) projectLocks(id).delete(relative);
          recordChanges(
            next,
            member,
            next.files,
            `${target.nickname} · ${input.role === 'removed' ? '참여 권한 회수' : '역할 변경'}`,
          );
          await persist(next);
          return envelope(next, member);
        }
        if (action === 'history-change') {
          editable(project, member);
          if (input.direction !== 'undo' && input.direction !== 'redo')
            throw new ApiError('편집 방향이 올바르지 않습니다.');
          if (
            typeof input.operationId !== 'string' ||
            !/^[a-f0-9-]{36}$/.test(input.operationId)
          )
            throw new ApiError('작업 ID가 올바르지 않습니다.');
          const applied = project.applied.find(
            (operation) => operation.id === input.operationId,
          );
          if (applied) {
            if (applied.memberId !== member.id)
              throw new ApiError('작업 ID가 충돌했습니다.');
            return envelope(project, member);
          }
          const record = project.history.find(
            (record) => record.entry.id === input.id,
          );
          if (
            !record ||
            record.entry.kind !== 'user' ||
            record.entry.actorId !== member.id
          )
            throw new ApiError('본인의 편집 작업만 되돌릴 수 있습니다.', 403);
          for (const file of record.entry.files) {
            if (file.relativePath.startsWith('.ai/tasks/')) admin(member);
            if (projectLocks(id).has(file.relativePath))
              throw new ApiError('해당 문서의 편집이 끝난 뒤 되돌려주세요.');
          }
          const files = invertEdit(
            project.files,
            record.before,
            record.after,
            input.direction,
          );
          checkSnapshot(files);
          const next = structuredClone(project);
          recordChanges(
            next,
            member,
            files,
            `${input.direction === 'undo' ? '실행 취소' : '다시 실행'} · ${record.entry.label}`,
          );
          next.applied.push({
            id: input.operationId,
            memberId: member.id,
            result: null,
          });
          next.applied = next.applied.slice(-500);
          await persist(next);
          return envelope(next, member);
        }
        if (action === 'history')
          return project.history
            .map((record) => {
              const entry = withTaskHistory(
                record.entry,
                record.before,
                record.after,
              );
              const taskPath = historyTaskPath(entry);
              const aiTask =
                !entry.aiTask && taskPath
                  ? taskHistoryRecord(project.files[taskPath], 'legacy')
                  : undefined;
              return aiTask ? { ...entry, aiTask } : entry;
            })
            .reverse();
        if (action === 'history-read') {
          const item = project.history.find(
            (record) => record.entry.id === input.id,
          );
          if (!item || !['before', 'after'].includes(String(input.version)))
            throw new ApiError('기록을 찾을 수 없습니다.');
          return (
            item[input.version as 'before' | 'after'][
              collaborationPath(input.relativePath)
            ] ?? null
          );
        }
        if (action === 'restore') {
          admin(member);
          editable(project, member);
          if (projectLocks(id).size)
            throw new ApiError('다른 문서 편집이 끝난 뒤 복원해주세요.');
          if (input.revision !== project.revision)
            throw new ApiError(
              '복원 확인 이후 변경되었습니다. 최신 내용을 확인해주세요.',
            );
          const record = project.history.find(
            (record) => record.entry.id === input.id,
          );
          if (!record || record.entry.status !== 'completed')
            throw new ApiError('복원할 기록을 찾을 수 없습니다.');
          const single = input.relativePath
            ? collaborationPath(input.relativePath)
            : null;
          if (
            single &&
            record.entry.files.some((file) =>
              file.relativePath.startsWith('sections/'),
            )
          )
            throw new ApiError('섹션 소속이 변경된 기록은 함께 복원해주세요.');
          if (
            single &&
            record.entry.files.some((file) => isAssetPath(file.relativePath))
          )
            throw new ApiError(
              '이미지와 설명 문서는 전체 기록으로 함께 복원해주세요.',
            );
          const version = input.version === 'after' ? 'after' : 'before';
          if (
            single &&
            record.entry.files.some((file) =>
              isImportedPreviewPath(file.relativePath),
            )
          )
            throw new ApiError(
              '불러온 HTML과 관리 문서는 전체 기록으로 함께 복원해주세요.',
            );
          const next = structuredClone(project),
            files = { ...next.files };
          for (const file of record.entry.files.filter(
            (file) => !single || file.relativePath === single,
          )) {
            const value = record[version][file.relativePath];
            if (value === undefined) delete files[file.relativePath];
            else files[file.relativePath] = value;
          }
          checkSnapshot(files);
          recordChanges(next, member, files, '이전 버전 복원', 'restore');
          await persist(next);
          return envelope(next, member);
        }
        if (action.startsWith('ai-')) {
          if (member.role === 'viewer')
            throw new ApiError(
              '뷰어는 AI를 실행하거나 중지할 수 없습니다.',
              403,
            );
          if (action === 'ai-start') {
            const providerId = input.providerId ?? 'codex-cli';
            if (!isAiProvider(providerId))
              throw new CanvasError(
                'GC-AI-009',
                '지원하지 않는 AI 제공자입니다.',
              );
            if (project.job)
              throw new ApiError('이미 AI 작업이 진행 중입니다.');
            if (projectLocks(id).size)
              throw new ApiError(
                '편집 중인 메모가 있습니다. 참여자들이 저장하고 편집을 종료한 뒤 실행해주세요.',
              );
            if (input.revision !== project.revision)
              throw new ApiError(
                'AI 실행 직전 문서가 변경되었습니다. 최신 내용을 확인하고 다시 실행해주세요.',
              );
            const taskPath = collaborationPath(input.taskPath);
            if (!taskPath.startsWith('.ai/tasks/') || !project.files[taskPath])
              throw new ApiError('AI 작업 명세를 찾을 수 없습니다.');
            const outputs = expectedArtifacts(project.files[taskPath]);
            validateHtmlAnalysis(project.files[taskPath], project.files);
            if (
              matter(project.files[taskPath]).data.source_mode === 'html' &&
              input.htmlAnalysisVersion !== 1
            )
              throw new CanvasError(
                'GC-AI-007',
                'HTML 분석 실행에는 관리자 앱 v0.7.10 이상이 필요합니다.',
              );
            if (
              workflowStages(project.files[taskPath]).length &&
              input.gamejamVersion !== 1
            )
              throw new ApiError(
                '이 연속 작업은 관리자 앱 v0.7.9 이상에서 실행해주세요.',
              );
            if (newOutputsAlreadyExist(project.files[taskPath], project.files))
              throw new ApiError(
                '이미 생성된 새 버전입니다. 새 작업을 만들어주세요.',
              );
            const next = structuredClone(project),
              runId = randomUUID();
            recordChanges(
              next,
              member,
              taskState(next.files, taskPath, 'running'),
              'AI 작업 시작',
              'ai',
              {
                status: 'starting',
                providerId,
                taskPath,
                modelId:
                  typeof input.modelId === 'string'
                    ? input.modelId.slice(0, 128)
                    : null,
              },
            );
            const event: CodexRunEvent = {
              providerId,
              modelId:
                typeof input.modelId === 'string'
                  ? input.modelId.slice(0, 128)
                  : null,
              actorId: member.id,
              runId,
              taskPath,
              status: 'starting',
              kind: 'status',
              message: `${member.nickname}님이 AI 작업을 시작했습니다. 문서 편집이 잠깁니다.`,
              timestamp: Date.now(),
            };
            next.job = {
              providerId,
              startedAt: Date.now(),
              modelId:
                typeof input.modelId === 'string'
                  ? input.modelId.slice(0, 128)
                  : null,
              id: secret(),
              memberId: member.id,
              taskPath,
              outputs,
              revision: project.revision,
              baselineHash: digest(JSON.stringify(next.files)),
              expiresAt: Date.now() + 30_000,
              event,
            };
            await persist(next);
            return { ...envelope(next, member), lease: next.job.id };
          }
          const job = project.job;
          if (!job)
            throw new ApiError(
              'AI 작업이 끝났거나 실행 권한이 만료되었습니다.',
            );
          if (action === 'ai-cancel') {
            if (member.role !== 'admin' && job.memberId !== member.id)
              throw new ApiError(
                '본인이 실행한 작업만 중지할 수 있습니다. 다른 작업은 관리자에게 요청해주세요.',
                403,
              );
            const next = structuredClone(project);
            next.lastRun = {
              ...job.event,
              status: 'cancelled',
              kind: 'status',
              message: `${member.nickname}님이 작업을 중지했습니다. 기존 결과를 유지합니다.`,
              timestamp: Date.now(),
            };
            recordChanges(
              next,
              member,
              taskState(next.files, job.taskPath, 'cancelled'),
              'AI 작업 중지',
              'ai',
              {
                status: 'cancelled',
                taskPath: job.taskPath,
                modelId: job.modelId,
                providerId: job.providerId ?? 'codex-cli',
                createdAt: job.startedAt ?? job.event.timestamp,
              },
            );
            next.job = null;
            await persist(next);
            return envelope(next, member);
          }
          if (job.memberId !== member.id || job.id !== input.lease)
            throw new ApiError('AI 실행 권한이 올바르지 않습니다.', 403);
          if (action === 'ai-heartbeat') {
            project.job!.expiresAt = Date.now() + 30_000;
            return {};
          }
          if (action === 'ai-progress') {
            const status = input.status;
            if (!['starting', 'running', 'validating'].includes(String(status)))
              throw new ApiError('작업 상태가 올바르지 않습니다.');
            job.event = {
              ...job.event,
              status: status as CodexRunEvent['status'],
              message: `${member.nickname}님 · ${status === 'validating' ? '결과 검증 중' : 'AI 실행 중'}`,
              timestamp: Date.now(),
            };
            return envelope(project, member);
          }
          if (action === 'ai-finish') {
            const next = structuredClone(project),
              success = input.status === 'completed';
            if (job.baselineHash !== digest(JSON.stringify(project.files)))
              throw new CanvasError(
                'GC-SYNC-001',
                'AI 입력 버전이 변경되어 결과를 반영하지 않습니다.',
              );
            let files = next.files;
            if (success) {
              const artifacts = input.artifacts;
              if (
                !artifacts ||
                typeof artifacts !== 'object' ||
                Array.isArray(artifacts) ||
                Object.keys(artifacts).length !== job.outputs.length ||
                Object.keys(artifacts).some(
                  (relative) => !job.outputs.includes(relative),
                )
              )
                throw new ApiError('허용된 AI 결과만 제출할 수 있습니다.');
              files = { ...files, ...(artifacts as Snapshot) };
              checkSnapshot(files);
              validateArtifacts(project.files, files, job.outputs);
              validateHtmlAnalysis(
                project.files[job.taskPath],
                files,
                job.outputs,
              );
            }
            const status = success
              ? 'completed'
              : input.status === 'cancelled'
                ? 'cancelled'
                : 'failed';
            const report = input.failure as
              | { code?: unknown; message?: unknown }
              | undefined;
            const failure =
              status === 'failed'
                ? failureInfo(
                    new CanvasError(
                      report &&
                        typeof report.code === 'string' &&
                        Object.hasOwn(ERROR_CODES, report.code)
                        ? (report.code as ErrorCode)
                        : 'GC-AI-002',
                      typeof report?.message === 'string'
                        ? report.message.slice(0, 4000)
                        : 'AI 작업이 실패했습니다.',
                    ),
                  )
                : undefined;
            const task = matter(files[job.taskPath]);
            files = {
              ...files,
              [job.taskPath]: matter.stringify(task.content, {
                ...task.data,
                status,
                ai_finished_at: new Date().toISOString(),
                ai_error: failure ? errorText(failure) : null,
                ai_error_code: failure?.code ?? null,
              }),
            };
            recordChanges(
              next,
              member,
              files,
              success ? 'AI 결과 반영' : 'AI 작업 종료',
              'ai',
              {
                status,
                taskPath: job.taskPath,
                failure,
                createdAt: job.startedAt ?? job.event.timestamp,
                modelId: job.modelId,
                providerId: job.providerId ?? 'codex-cli',
              },
            );
            next.lastRun = {
              ...job.event,
              status,
              kind: success ? 'result' : 'status',
              message: success
                ? 'AI 결과를 공동 프로젝트에 반영했습니다.'
                : 'AI 작업이 종료되었습니다. 기존 결과를 유지합니다.',
              timestamp: Date.now(),
              failure,
            };
            next.job = null;
            await persist(next);
            return envelope(next, member);
          }
          throw new ApiError('지원하지 않는 AI 작업입니다.', 404);
        }
        throw new ApiError('지원하지 않는 작업입니다.', 404);
      });
      reply(response, 200, result);
    } catch (error) {
      const failure = failureInfo(error, 'GC-COLLAB-001');
      reply(response, error instanceof ApiError ? error.status : 400, {
        error: errorText(failure),
        failure,
      });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4317, host, resolve);
  });
  const address = server.address();
  return {
    server,
    port: typeof address === 'object' && address ? address.port : 4317,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

export { activeEvent };
