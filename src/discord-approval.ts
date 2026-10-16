import { createHash, randomUUID } from 'node:crypto';
import {
  discordTextPages,
  documentFilename,
  type ApprovalDocuments,
  type DiscordReviewSnapshot,
  type DiscordSnapshotReceipt,
} from './discord-review-documents.ts';
import { isAiProvider, aiProvider } from './ai-providers.ts';
import {
  APPROVAL_STATUS_NAMES,
  approvalEditable,
  type ApprovalDetail,
  type ApprovalList,
  type ApprovalStart,
  type GamejamApproval,
} from './gamejam-approval.ts';
import type {
  DiscordApprovalInput,
  DiscordApprovalStatus,
  DiscordProjectBinding,
} from './discord-approval-types.ts';
import type {
  DiscordApprovalStore,
  DiscordSavedApproval,
} from './discord-approval-store.ts';
import type {
  DiscordTransport,
  DiscordAction,
  DiscordMessage,
} from './discord-transport.ts';

export type DiscordApprovalContext = DiscordProjectBinding & {
  list(): Promise<ApprovalList>;
  read(id: string): Promise<ApprovalDetail>;
  documents(
    id: string,
    revision: number,
    reviewToken: string,
  ): Promise<ApprovalDocuments>;
  start(
    approval: ApprovalStart,
    settings: DiscordApprovalInput,
    authorized: () => void,
  ): Promise<void>;
  feedback(
    id: string,
    revision: number,
    message: string,
    commandId: string,
  ): Promise<void>;
};
type Review = {
  detail: ApprovalDetail;
  pages: string[];
  page: number;
  expires: number;
  commandId: string;
  used: boolean;
  snapshot?: DiscordSnapshotReceipt;
  channelId?: string;
  readOnly?: boolean;
};
type Store = Pick<
  DiscordApprovalStore,
  'load' | 'save' | 'clear' | 'saveSnapshot' | 'readSnapshot'
>;
const snowflake = /^\d{17,20}$/;
const sameBinding = (a: DiscordProjectBinding, b: DiscordProjectBinding) =>
  a.serverUrl === b.serverUrl &&
  a.projectId === b.projectId &&
  a.memberId === b.memberId;
const button = (custom_id: string, label: string, style: 1 | 2 | 3 = 2) => ({
  type: 2 as const,
  custom_id,
  label,
  style,
});
const body = (content: string): DiscordMessage => ({
  content,
  allowed_mentions: { parse: [] },
});
const failureText = (error: unknown) =>
  error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';
const discordTime = (at: number) => `<t:${Math.floor(at / 1000)}:F>`;

export function discordReviewText(
  detail: ApprovalDetail,
  saved: Pick<DiscordSavedApproval, 'settings' | 'binding'>,
) {
  const r = detail.item.request;
  return [
    `${saved.binding.projectName} · ${r.resultName || 'Game Jam! 요청'}`,
    `요청자: ${detail.item.authorName} · 수정 버전 ${detail.item.revision}`,
    `실행: ${aiProvider(saved.settings.providerId).label} · ${saved.settings.modelId || '자동 선택'}`,
    `작업: ${[r.organize && '문서 정리', r.implement && 'HTML 구현'].filter(Boolean).join(' → ')}`,
    `입력 자료:\n${r.inputPaths.join('\n')}`,
    `문서 출력: ${JSON.stringify(r.documentResult ?? null)}`,
    `HTML 출력: ${JSON.stringify(r.htmlResult ?? null)}`,
    `입력 방식: ${r.sourceMode || '문서'} · 캔버스: ${r.canvasId || '기본'}`,
    `멀티플레이: ${JSON.stringify(r.multiplayer ?? null)}`,
    ...(r.organize ? [`문서 정리 지침:\n${r.instructions.organize}`] : []),
    ...(r.implement ? [`HTML 구현 지침:\n${r.instructions.implement}`] : []),
    '이 버전과 연결된 입력 자료로 이 PC에서 실행합니다. 선택한 Markdown 본문은 스레드의 검토 사본과 내용 보기에서 확인할 수 있습니다.',
  ].join('\n\n');
}

/** One explicitly configured admin app owns the bot; the existing server owns approval atomicity. */
export class DiscordApprovalService {
  private saved: DiscordSavedApproval | null = null;
  private transport: DiscordTransport | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private accepting = false;
  private lastTestAt = 0;
  private reviews = new Map<string, Review>();
  private lanes = new Map<string, Promise<unknown>>();
  private message = '디스코드가 연결되지 않았습니다.';
  private store: Store;
  private context: () => DiscordApprovalContext | null;
  private factory: (
    action: (a: DiscordAction) => Promise<void>,
    failure: () => void,
  ) => DiscordTransport | Promise<DiscordTransport>;
  constructor(
    store: Store,
    context: () => DiscordApprovalContext | null,
    factory: (
      action: (a: DiscordAction) => Promise<void>,
      failure: () => void,
    ) => DiscordTransport | Promise<DiscordTransport>,
  ) {
    this.store = store;
    this.context = context;
    this.factory = factory;
  }
  status(): DiscordApprovalStatus {
    const active = this.saved && this.context();
    return {
      configured: !!this.saved,
      connected: !!this.transport?.ready(),
      message:
        this.saved && (!active || !sameBinding(active, this.saved.binding))
          ? '연결한 공동 프로젝트를 관리자 계정으로 열어주세요. 현재 원격 실행은 대기 중입니다.'
          : this.message,
      settings: this.saved ? { ...this.saved.settings } : undefined,
      projectName: this.saved?.binding.projectName,
    };
  }
  async resume() {
    try {
      this.saved = await this.store.load();
      if (this.saved) {
        if (!this.saved.historySince) {
          this.saved.historySince = Date.now();
          await this.store.save(this.saved);
        }
        await this.open();
        this.accepting = true;
      }
    } catch {
      this.message =
        '디스코드 연결을 복원하지 못했습니다. 토큰과 채널 권한을 확인하고 다시 연결해주세요.';
    }
  }
  async configure(input: DiscordApprovalInput) {
    const context = this.context();
    if (!context)
      throw Error('동기화를 마친 공동 프로젝트 관리자만 연결할 수 있습니다.');
    if (
      !input ||
      typeof input.channelId !== 'string' ||
      typeof input.userId !== 'string' ||
      (input.token !== undefined && typeof input.token !== 'string') ||
      !snowflake.test(input.channelId) ||
      !snowflake.test(input.userId) ||
      !isAiProvider(input.providerId) ||
      typeof input.threads !== 'boolean' ||
      typeof input.modelId !== 'string' ||
      input.modelId.length > 128 ||
      (input.modelId && !/^[a-zA-Z0-9._:/-]+$/.test(input.modelId))
    )
      throw Error('채널 ID, 사용자 ID, AI 설정을 확인해주세요.');
    const token = input.token?.trim() || this.saved?.token;
    if (!token || token.length > 256 || /\s/.test(token))
      throw Error('봇 토큰을 입력해주세요.');
    this.stop();
    const previous = this.saved;
    this.saved = {
      version: 1,
      token,
      settings: {
        channelId: input.channelId,
        userId: input.userId,
        providerId: input.providerId,
        modelId: input.modelId,
        threads: input.threads,
      },
      binding: {
        serverUrl: context.serverUrl,
        projectId: context.projectId,
        memberId: context.memberId,
        projectName: context.projectName,
      },
      notifications:
        previous &&
        sameBinding(previous.binding, context) &&
        previous.settings.channelId === input.channelId &&
        previous.token === token
          ? previous.notifications
          : {},
      historySince:
        previous && sameBinding(previous.binding, context)
          ? (previous.historySince ?? Date.now())
          : Date.now(),
    };
    try {
      await this.open(false);
      this.authority(this.saved);
      await this.store.save(this.saved);
      this.accepting = true;
      this.beginPolling();
    } catch {
      this.stop();
      this.saved = previous;
      this.message =
        '연결하지 못했습니다. 봇 토큰과 비공개 채널 접근 권한을 확인해주세요.';
      throw Error(this.message);
    }
    return this.status();
  }
  async sendTest() {
    const saved = this.saved,
      transport = this.transport;
    if (!saved || !this.accepting || !transport?.ready())
      throw Error('먼저 디스코드 설정을 저장하고 연결해주세요.');
    this.authority(saved);
    if (Date.now() - this.lastTestAt < 5000)
      throw Error('테스트 알림을 방금 보냈습니다. 잠시 후 다시 시도해주세요.');
    this.lastTestAt = Date.now();
    let messageId: string;
    try {
      messageId = await transport.send(saved.settings.channelId, {
        ...body(
          `**Game Jam! 테스트 알림**\n프로젝트: ${saved.binding.projectName}\n이 메시지는 연결 확인용입니다. 실제 요청을 등록하거나 AI를 실행하지 않습니다.\n아래 버튼으로 디스코드 버튼 연결도 확인할 수 있습니다.`,
        ),
        components: [
          { type: 1, components: [button('gj:test', '테스트 수신 확인', 1)] },
        ],
      });
    } catch {
      throw Error(
        '테스트 알림을 보내지 못했습니다. 비공개 채널 접근과 메시지 보내기 권한·네트워크 상태를 확인해주세요.',
      );
    }
    this.authority(saved);
    if (saved.settings.threads) {
      try {
        const thread = await transport.thread(
          saved.settings.channelId,
          messageId,
          'Game Jam! 테스트 알림',
        );
        this.authority(saved);
        await transport.send(
          thread,
          body(
            '테스트 스레드 전송도 정상입니다. 실제 구현 요청과 AI 실행은 생성하지 않았습니다.',
          ),
        );
      } catch {
        return {
          message:
            '채널에 테스트 알림을 보냈습니다. 스레드 전송은 실패했으니 공개 스레드 만들기·스레드 메시지 보내기 권한을 확인해주세요.',
        };
      }
    }
    return {
      message:
        '테스트 알림을 보냈습니다. 디스코드의 ‘테스트 수신 확인’ 버튼을 눌러 버튼 연결도 확인해주세요.',
    };
  }
  async disconnect() {
    this.stop();
    this.saved = null;
    await this.store.clear();
    this.message = '연결을 해제하고 이 PC의 봇 토큰을 삭제했습니다.';
    return this.status();
  }
  stop() {
    this.accepting = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.transport?.close();
    this.transport = null;
    this.reviews.clear();
  }
  private async open(poll = true) {
    const saved = this.saved!;
    this.message = '디스코드에 연결하는 중입니다.';
    const transport = await this.factory(
      (a) => this.handle(a),
      () => {
        this.message =
          '디스코드 연결 상태를 확인해주세요. 자동 재연결을 시도합니다.';
      },
    );
    this.transport = transport;
    try {
      await transport.connect(
        saved.token,
        saved.settings.channelId,
        saved.settings.threads,
      );
    } catch {
      transport.close();
      if (this.transport === transport) this.transport = null;
      throw Error('Discord connection failed');
    }
    this.message = '연결됨 · 이 PC에서 요청 알림과 원격 승인을 받습니다.';
    if (poll) this.beginPolling();
  }
  private beginPolling() {
    this.timer = setInterval(() => {
      void this.poll();
    }, 5000);
    this.timer.unref?.();
    void this.poll();
  }
  private authority(saved: DiscordSavedApproval) {
    const context = this.context();
    if (
      this.saved !== saved ||
      !this.transport?.ready() ||
      !context ||
      !sameBinding(saved.binding, context)
    )
      throw Error(
        '연결한 공동 프로젝트와 관리자 권한·동기화 상태를 확인해주세요.',
      );
    return context;
  }
  private serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const result = (this.lanes.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(operation);
    this.lanes.set(key, result);
    void result
      .finally(() => {
        if (this.lanes.get(key) === result) this.lanes.delete(key);
      })
      .catch(() => undefined);
    return result;
  }
  private async persist(saved: DiscordSavedApproval) {
    this.authority(saved);
    await this.store.save(saved);
    this.authority(saved);
  }
  private async recordChannel(saved: DiscordSavedApproval, id: string) {
    return this.serial(`thread:${id}`, async () => {
      this.authority(saved);
      const receipt = saved.notifications[id];
      if (!receipt) throw Error('원본 요청 알림을 먼저 확인해주세요.');
      if (saved.settings.threads && !receipt.threadId) {
        receipt.threadId = await this.transport!.thread(
          saved.settings.channelId,
          receipt.messageId,
          'Game Jam! 요청 이력',
        );
        this.authority(saved);
        await this.persist(saved);
      }
      return saved.settings.threads
        ? (receipt.threadId ?? saved.settings.channelId)
        : saved.settings.channelId;
    });
  }
  private nonce(key: string) {
    return createHash('sha256').update(key).digest('hex').slice(0, 24);
  }
  private async history(saved: DiscordSavedApproval, item: GamejamApproval) {
    return this.serial(`history:${item.id}`, async () => {
      const receipt = saved.notifications[item.id];
      const channelId = await this.recordChannel(saved, item.id);
      const labels: Record<string, string> = {
        'requests-create': '요청 등록',
        'requests-update': '요청 수정',
        'requests-feedback': '보완 요청',
        'requests-cancel': '요청 취소',
        'requests-delete': '요청 삭제',
        approved: '승인 · 구현 접수',
        queued: '실행 예약',
        running: '구현 시작',
        completed: '구현 완료',
        failed: '구현 실패',
        stopped: '구현 중지',
      };
      for (
        let index = receipt.historyCount ?? 0;
        index < item.changes.length;
        index++
      ) {
        const change = item.changes[index];
        const label =
          change.action === 'approved' && change.status === 'queued'
            ? '승인 · 실행 예약'
            : (labels[change.action] ?? change.action);
        let text = `**${label}** · 요청 ${change.request?.resultName || item.request.resultName || item.id}\n수정 버전 ${change.revision} · ${change.actorName}\n시각: ${discordTime(change.at)}\n`;
        if (change.request)
          text += `\n입력 문서:\n${change.request.inputPaths.join('\n')}\n문서 정리 지침:\n${change.request.instructions.organize}\nHTML 구현 지침:\n${change.request.instructions.implement}\n`;
        if (change.message) text += `\n의견·이유: ${change.message}\n`;
        if (change.action === 'approved' || change.action === 'queued') {
          const copies = Object.values(receipt.snapshots ?? {});
          const snapshot =
            copies.find(
              (r) =>
                r.complete && r.approvalCommandId === item.approvalCommandId,
            ) ??
            copies.find(
              (r) =>
                r.revision === item.approvedRevision &&
                r.reviewToken === item.approvedReviewToken &&
                r.complete,
            );
          text += snapshot
            ? `\n승인 기준 문서 사본: ${snapshot.id}\n검토한 요청 버전: ${snapshot.revision}\n`
            : '\n앱 또는 이전 버전에서 승인한 요청입니다. 이 승인에 연결된 디스코드 문서 사본은 없습니다.\n';
        }
        if (['completed', 'failed', 'stopped'].includes(change.action))
          text += `\n${item.outputs?.join('\n') ?? ''}\n${item.error ?? ''}`;
        const pages = discordTextPages(text);
        for (let part = receipt.historyPart ?? 0; part < pages.length; part++) {
          this.authority(saved);
          await this.transport!.send(channelId, {
            ...body(
              `${pages[part]}\n이력 ${index + 1} · ${part + 1}/${pages.length}`,
            ),
            nonce: this.nonce(
              `${channelId}:${item.id}:history:${index}:${part}`,
            ),
            enforce_nonce: true,
          });
          this.authority(saved);
          receipt.historyPart = part + 1;
          await this.persist(saved);
        }
        receipt.historyCount = index + 1;
        receipt.historyPart = 0;
        await this.persist(saved);
      }
    });
  }
  private async snapshot(
    saved: DiscordSavedApproval,
    detail: ApprovalDetail,
  ): Promise<DiscordSnapshotReceipt> {
    return this.serial(`snapshot:${detail.item.id}`, async () => {
      const context = this.authority(saved);
      if (!detail.reviewToken || !approvalEditable(detail.item.status))
        throw Error('승인 가능한 최신 요청을 다시 검토해주세요.');
      const receipt = saved.notifications[detail.item.id];
      if (!receipt) throw Error('원본 요청 알림을 먼저 확인해주세요.');
      const channelId = await this.recordChannel(saved, detail.item.id);
      const key = createHash('sha256')
        .update(
          JSON.stringify([
            detail.item.revision,
            detail.reviewToken,
            saved.settings.providerId,
            saved.settings.modelId,
            channelId,
          ]),
        )
        .digest('hex');
      let record = receipt.snapshots?.[key];
      let snapshot: DiscordReviewSnapshot;
      if (record) snapshot = await this.store.readSnapshot(record.id);
      else {
        const captured = await context.documents(
          detail.item.id,
          detail.item.revision,
          detail.reviewToken,
        );
        this.authority(saved);
        if (
          captured.requestId !== detail.item.id ||
          captured.revision !== detail.item.revision ||
          captured.reviewToken !== detail.reviewToken
        )
          throw Error('입력 문서가 변경되었습니다. 다시 검토해주세요.');
        snapshot = {
          ...captured,
          version: 1,
          id: randomUUID(),
          item: structuredClone(detail.item),
          providerId: saved.settings.providerId,
          modelId: saved.settings.modelId,
        };
        await this.store.saveSnapshot(snapshot);
        this.authority(saved);
        record = {
          id: snapshot.id,
          revision: captured.revision,
          reviewToken: captured.reviewToken,
          channelId,
          messageIds: [],
        };
        (receipt.snapshots ??= {})[key] = record;
        await this.persist(saved);
      }
      // Never silently move a reviewed copy into a different thread or project.
      if (record.channelId !== channelId)
        throw Error(
          '문서 사본의 기록 위치가 변경되었습니다. 설정을 다시 확인해주세요.',
        );
      try {
        if (!record.messageIds[0]) {
          record.messageIds[0] = await this.transport!.send(channelId, {
            ...body(
              `**검토 자료 사본** · 요청 버전 ${snapshot.revision}\n사본 ID: ${snapshot.id}\n기록 시각: ${discordTime(snapshot.capturedAt)}\nMarkdown ${snapshot.documents.length}개 · 현재 원본과 구분되는 검토 당시 사본입니다.\n${snapshot.unsupported.length ? 'HTML·이미지 등 Markdown 이외의 입력은 앱에서 확인해주세요.' : ''}`,
            ),
            files: [
              {
                name: `request-r${snapshot.revision}.md`,
                data: Buffer.from(
                  discordReviewText({ ...detail, item: snapshot.item }, saved),
                  'utf8',
                ),
              },
            ],
            nonce: this.nonce(`${channelId}:${snapshot.id}:manifest`),
            enforce_nonce: true,
          });
          this.authority(saved);
          await this.persist(saved);
        }
        for (let index = 0; index < snapshot.documents.length; index++) {
          if (record.messageIds[index + 1]) continue;
          const doc = snapshot.documents[index];
          const preview =
            doc.content.length <= 1100
              ? doc.content
              : `${doc.content.slice(0, 350)}\n… 전체 본문은 내용 보기 또는 첨부 파일에서 확인하세요.`;
          record.messageIds[index + 1] = await this.transport!.send(channelId, {
            ...body(
              `**입력 문서 ${index + 1}/${snapshot.documents.length} · 요청 버전 ${snapshot.revision}**\n검토 사본: ${snapshot.id}\n${doc.path.slice(0, 200)}\nSHA-256: ${doc.sha256}\n\n${preview}`,
            ),
            files: [
              {
                name: documentFilename(doc, index, snapshot.revision),
                data: Buffer.from(doc.content, 'utf8'),
              },
            ],
            components: [
              {
                type: 1,
                components: [
                  button(
                    `gj:doc:${detail.item.id}:${snapshot.id}:${index}`,
                    '내용 보기',
                    1,
                  ),
                ],
              },
            ],
            nonce: this.nonce(`${channelId}:${snapshot.id}:doc:${index}`),
            enforce_nonce: true,
          });
          this.authority(saved);
          await this.persist(saved);
        }
        record.complete = true;
        await this.persist(saved);
      } catch {
        throw Error(
          '검토 사본을 기록하지 못했습니다. 파일 첨부·채널/스레드 권한과 연결을 확인한 뒤 다시 검토해주세요. 아직 승인하지 않았습니다.',
        );
      }
      const fresh = await context.read(detail.item.id);
      this.authority(saved);
      if (
        fresh.item.revision !== detail.item.revision ||
        fresh.reviewToken !== detail.reviewToken
      )
        throw Error(
          '검토 사본 기록 중 요청이나 입력 문서가 변경되었습니다. 다시 검토해주세요.',
        );
      return record;
    });
  }
  async poll() {
    const saved = this.saved,
      transport = this.transport;
    if (this.polling || !saved || !transport?.ready()) return;
    this.polling = true;
    try {
      const context = this.authority(saved);
      const list = await context.list();
      this.authority(saved);
      let threadsPending = false;
      for (const item of list.items) {
        this.authority(saved);
        let receipt = saved.notifications[item.id];
        if (
          !receipt &&
          !approvalEditable(item.status) &&
          item.status !== 'deleted' &&
          item.createdAt < (saved.historySince ?? Date.now())
        )
          continue;
        const signature = JSON.stringify([
          item.revision,
          item.status,
          item.updatedAt,
          item.runId,
          item.outputs,
          item.error,
          item.deletion,
        ]);
        const payload: DiscordMessage = {
          ...body(
            item.status === 'deleted' && item.deletion
              ? `**${saved.binding.projectName.slice(0, 120)} · ${(item.request.resultName || 'Game Jam! 요청').slice(0, 120)}**\n요청자: ${item.authorName.slice(0, 80)} · 수정 버전 ${item.revision}\n상태: **삭제됨**\n삭제 관리자: ${item.deletion.actorName.slice(0, 80)}\n삭제 이유: ${item.deletion.reason}\n요청 기록과 결과 파일은 앱에서 확인할 수 있습니다.`
              : `**${saved.binding.projectName} · ${item.request.resultName || 'Game Jam! 요청'}**\n요청자: ${item.authorName} · 수정 버전 ${item.revision}\n상태: **${APPROVAL_STATUS_NAMES[item.status]}**\n${item.feedback ? `보완 의견: ${item.feedback.slice(0, 500)}\n` : ''}${item.outputs?.length ? `결과: ${item.outputs.join(', ').slice(0, 500)}\n` : ''}${item.error ? `오류: ${item.error.slice(0, 400)}\n` : ''}승인 시 연결된 관리자 PC에서 실행합니다.`,
          ),
          components: approvalEditable(item.status)
            ? [
                {
                  type: 1,
                  components: [
                    button(
                      `gj:review:${item.id}:${item.revision}`,
                      '내용 확인·승인',
                      1,
                    ),
                    button(
                      `gj:feedback:${item.id}:${item.revision}`,
                      '보완 요청',
                    ),
                  ],
                },
              ]
            : [],
        };
        if (!receipt) {
          const messageId = await transport.send(
            saved.settings.channelId,
            payload,
          );
          this.authority(saved);
          receipt = saved.notifications[item.id] = {
            messageId,
            revision: item.revision,
            signature,
          };
          await this.persist(saved);
        } else if (receipt.signature !== signature) {
          try {
            await transport.update(
              saved.settings.channelId,
              receipt.messageId,
              payload,
            );
          } catch (e) {
            if ((e as { code?: number }).code !== 10008) throw e;
            receipt.messageId = await transport.send(
              saved.settings.channelId,
              payload,
            );
            receipt.threadId = undefined;
          }
          this.authority(saved);
          receipt.signature = signature;
          receipt.revision = item.revision;
          await this.persist(saved);
        }
        try {
          await this.history(saved, item);
          if (receipt.announced !== signature) {
            const recordChannel = await this.recordChannel(saved, item.id);
            await transport.send(
              recordChannel,
              body(
                item.status === 'deleted' && item.deletion
                  ? `수정 버전 ${item.revision} · 삭제됨\n삭제 관리자: ${item.deletion.actorName.slice(0, 80)}\n삭제 이유: ${item.deletion.reason}`
                  : `수정 버전 ${item.revision} · ${APPROVAL_STATUS_NAMES[item.status]}${item.outputs?.length ? `\n${item.outputs.join('\n').slice(0, 1400)}` : ''}`,
              ),
            );
            this.authority(saved);
            receipt.announced = signature;
            await this.persist(saved);
          }
        } catch {
          threadsPending = true;
        }
      }
      if (this.saved !== saved || this.transport !== transport) return;
      this.message = threadsPending
        ? '요청 알림 전송됨 · 스레드 기록은 권한 확인 후 자동 재시도합니다.'
        : '연결됨 · 요청과 실행 결과를 확인하고 있습니다.';
    } catch {
      if (this.saved === saved && this.transport === transport)
        this.message =
          '알림 전송 대기 · 프로젝트 연결과 채널·스레드 권한을 확인해주세요. 자동으로 재시도합니다.';
    } finally {
      this.polling = false;
    }
  }
  private expire() {
    for (const [id, review] of this.reviews)
      if (review.expires < Date.now()) this.reviews.delete(id);
    while (this.reviews.size >= 100)
      this.reviews.delete(this.reviews.keys().next().value!);
  }
  private review(id: string) {
    const review = this.reviews.get(id);
    if (!review || review.expires < Date.now())
      throw Error(
        '검토 시간이 지났습니다. 요청 메시지에서 내용을 다시 확인해주세요.',
      );
    return review;
  }
  private reviewBody(id: string, r: Review): DiscordMessage {
    return {
      ...body(`${r.pages[r.page]}\n\n검토 ${r.page + 1}/${r.pages.length}`),
      components: [
        {
          type: 1,
          components: [
            ...(r.page > 0
              ? [button(`gj:page:${id}:${r.page - 1}`, '이전')]
              : []),
            ...(r.page + 1 < r.pages.length
              ? [button(`gj:page:${id}:${r.page + 1}`, '다음')]
              : r.detail.reviewToken &&
                  approvalEditable(r.detail.item.status) &&
                  !r.used &&
                  !r.readOnly
                ? [button(`gj:approve:${id}`, '이 버전 승인하고 구현하기', 3)]
                : []),
          ],
        },
      ].filter((row) => row.components.length),
    };
  }
  async handle(action: DiscordAction) {
    if (!action.customId.startsWith('gj:')) return;
    const saved = this.saved;
    if (
      !saved ||
      !this.accepting ||
      action.userId !== saved.settings.userId ||
      (action.channelId !== saved.settings.channelId &&
        !Object.values(saved.notifications).some(
          (r) => r.threadId === action.channelId,
        ))
    ) {
      await action.reply(
        body('연결된 프로젝트 관리자만 이 채널에서 승인할 수 있습니다.'),
      );
      return;
    }
    let deferred = false;
    try {
      let context = this.authority(saved);
      const [, command, id, rawRevision, rawIndex] = action.customId.split(':');
      if (
        !['doc', 'page'].includes(command) &&
        action.channelId !== saved.settings.channelId
      )
        throw Error('원본 요청 채널에서 다시 시작해주세요.');
      if (command === 'test' && action.kind === 'button') {
        await action.reply(
          body(
            '테스트 버튼을 정상적으로 받았습니다. 알림과 버튼 연결이 정상입니다. 실제 요청 등록과 AI 실행은 하지 않았습니다.',
          ),
        );
        return;
      }
      if (command === 'feedback' && action.kind === 'button') {
        const receipt = saved.notifications[id];
        if (
          !receipt ||
          receipt.messageId !== action.messageId ||
          receipt.revision !== Number(rawRevision)
        )
          throw Error(
            '요청이 변경되었습니다. 최신 요청 메시지에서 다시 확인해주세요.',
          );
        this.expire();
        const key = randomUUID();
        this.reviews.set(key, {
          detail: {
            item: {
              id,
              revision: Number(rawRevision),
            } as ApprovalDetail['item'],
            reviewToken: null,
            outputs: [],
          },
          pages: [],
          page: 0,
          expires: Date.now() + 600_000,
          commandId: randomUUID(),
          used: false,
        });
        await action.modal(`gj:submit:${key}`);
        return;
      }
      await action.defer();
      deferred = true;
      if (command === 'doc' && action.kind === 'button') {
        const receipt = saved.notifications[id];
        const record = Object.values(receipt?.snapshots ?? {}).find(
          (r) => r.id === rawRevision,
        );
        const index = Number(rawIndex);
        if (
          !record?.complete ||
          !Number.isInteger(index) ||
          index < 0 ||
          record.channelId !== action.channelId ||
          !action.messageId ||
          record.messageIds[index + 1] !== action.messageId
        )
          throw Error(
            '스레드에 기록된 문서 사본의 내용 보기 버튼을 사용해주세요.',
          );
        const snapshot = await this.store.readSnapshot(record.id);
        this.authority(saved);
        const doc = snapshot.documents[index];
        if (
          !doc ||
          snapshot.requestId !== id ||
          snapshot.revision !== record.revision ||
          snapshot.reviewToken !== record.reviewToken
        )
          throw Error(
            '문서 사본을 확인할 수 없습니다. 스레드의 첨부 파일을 확인해주세요.',
          );
        this.expire();
        const key = randomUUID();
        const view: Review = {
          detail: { item: snapshot.item, reviewToken: null, outputs: [] },
          pages: discordTextPages(doc.content).map(
            (text) =>
              `문서: ${doc.path.slice(0, 200)}\n요청 버전 ${snapshot.revision} · 검토 사본 ${snapshot.id}\n\n${text}`,
          ),
          page: 0,
          expires: Date.now() + 600_000,
          commandId: randomUUID(),
          used: true,
          readOnly: true,
          channelId: action.channelId,
        };
        this.reviews.set(key, view);
        await action.edit(this.reviewBody(key, view));
      } else if (command === 'review' && action.kind === 'button') {
        const receipt = saved.notifications[id];
        if (!receipt || receipt.messageId !== action.messageId)
          throw Error('원본 요청 메시지에서 다시 확인해주세요.');
        const detail = await context.read(id);
        this.authority(saved);
        if (detail.item.revision !== Number(rawRevision))
          throw Error(
            '요청이 수정되었습니다. 최신 알림에서 내용을 다시 확인해주세요.',
          );
        const snapshot = await this.snapshot(saved, detail);
        const text = discordReviewText(detail, saved);
        const pages = discordTextPages(text);
        this.expire();
        const key = randomUUID();
        const review: Review = {
          detail,
          pages,
          page: 0,
          expires: Date.now() + 600_000,
          commandId: randomUUID(),
          used: false,
          snapshot,
          channelId: action.channelId,
        };
        this.reviews.set(key, review);
        await action.edit(this.reviewBody(key, review));
      } else if (command === 'page' && action.kind === 'button') {
        const review = this.review(id),
          page = Number(rawRevision);
        if (review.channelId && review.channelId !== action.channelId)
          throw Error('문서를 열었던 채널에서 다시 확인해주세요.');
        if (
          !Number.isInteger(page) ||
          page < 0 ||
          page >= review.pages.length ||
          Math.abs(page - review.page) !== 1
        )
          throw Error('검토 페이지가 올바르지 않습니다.');
        review.page = page;
        await action.edit(this.reviewBody(id, review));
      } else if (command === 'approve' && action.kind === 'button') {
        const review = this.review(id);
        if (review.used || review.readOnly)
          throw Error('이미 처리한 승인입니다. 요청 상태를 확인해주세요.');
        if (
          review.page !== review.pages.length - 1 ||
          !review.detail.reviewToken ||
          !review.snapshot?.complete
        )
          throw Error('전체 요청 내용을 확인한 뒤 승인해주세요.');
        review.used = true;
        context = this.authority(saved);
        review.snapshot.approvalCommandId = review.commandId;
        await this.persist(saved);
        await context.start(
          {
            id: review.detail.item.id,
            revision: review.detail.item.revision,
            reviewToken: review.detail.reviewToken,
            commandId: review.commandId,
          },
          saved.settings,
          () => {
            if (!this.accepting)
              throw Error(
                '디스코드 연결이 해제되었습니다. 다시 연결한 뒤 승인해주세요.',
              );
            this.authority(saved);
          },
        );
        // Read server-confirmed approval history; a Discord delivery failure must never rerun AI.
        try {
          const approved = await context.read(review.detail.item.id);
          this.authority(saved);
          await this.history(saved, approved.item);
        } catch {
          /* Polling retries durable server history after reconnection. */
        }
        await action.edit(
          body(
            '승인한 버전의 AI 구현 요청을 접수했습니다. 다른 작업이 있으면 예약 순서대로 실행합니다. 상태와 결과는 요청 메시지와 스레드에 반영됩니다.',
          ),
        );
        void this.poll();
      } else if (command === 'submit' && action.kind === 'modal') {
        const review = this.review(id);
        if (review.used || !action.feedback?.trim())
          throw Error('보완 의견을 확인해주세요.');
        review.used = true;
        await context.feedback(
          review.detail.item.id,
          review.detail.item.revision,
          action.feedback.trim(),
          review.commandId,
        );
        await action.edit(body('보완 의견을 요청자에게 전달했습니다.'));
        void this.poll();
      } else
        throw Error(
          '지원하지 않는 동작입니다. 최신 요청 메시지에서 다시 시작해주세요.',
        );
    } catch (error) {
      // Only application messages reach Discord; transport/authentication errors are never echoed.
      const message = failureText(error)
        .replaceAll(saved.token, '[숨김]')
        .slice(0, 1600);
      if (deferred) await action.edit(body(message));
      else await action.reply(body(message));
    }
  }
}
