import { randomUUID } from 'node:crypto';
import { isAiProvider, aiProvider } from './ai-providers.ts';
import {
  APPROVAL_STATUS_NAMES,
  approvalEditable,
  type ApprovalDetail,
  type ApprovalList,
  type ApprovalStart,
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
};
type Store = Pick<DiscordApprovalStore, 'load' | 'save' | 'clear'>;
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
    '이 버전과 연결된 입력 자료로 이 PC에서 실행합니다. 입력 자료의 본문은 Game Jam!에서 확인할 수 있습니다.',
  ].join('\n\n');
}

/** One explicitly configured admin app owns the bot; the existing server owns approval atomicity. */
export class DiscordApprovalService {
  private saved: DiscordSavedApproval | null = null;
  private transport: DiscordTransport | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private accepting = false;
  private reviews = new Map<string, Review>();
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
        if (!receipt && !approvalEditable(item.status)) continue;
        const signature = JSON.stringify([
          item.revision,
          item.status,
          item.updatedAt,
          item.runId,
          item.outputs,
          item.error,
        ]);
        const payload: DiscordMessage = {
          ...body(
            `**${saved.binding.projectName} · ${item.request.resultName || 'Game Jam! 요청'}**\n요청자: ${item.authorName} · 수정 버전 ${item.revision}\n상태: **${APPROVAL_STATUS_NAMES[item.status]}**\n${item.feedback ? `보완 의견: ${item.feedback.slice(0, 500)}\n` : ''}${item.outputs?.length ? `결과: ${item.outputs.join(', ').slice(0, 500)}\n` : ''}${item.error ? `오류: ${item.error.slice(0, 400)}\n` : ''}승인 시 연결된 관리자 PC에서 실행합니다.`,
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
          await this.store.save(saved);
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
          await this.store.save(saved);
        }
        try {
          if (saved.settings.threads && !receipt.threadId) {
            receipt.threadId = await transport.thread(
              saved.settings.channelId,
              receipt.messageId,
              item.request.resultName || 'Game Jam! 요청',
            );
            this.authority(saved);
            await this.store.save(saved);
          }
          if (receipt.threadId && receipt.announced !== signature) {
            await transport.send(
              receipt.threadId,
              body(
                `수정 버전 ${item.revision} · ${APPROVAL_STATUS_NAMES[item.status]}${item.outputs?.length ? `\n${item.outputs.join('\n').slice(0, 1400)}` : ''}`,
              ),
            );
            this.authority(saved);
            receipt.announced = signature;
            await this.store.save(saved);
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
                  !r.used
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
      action.channelId !== saved.settings.channelId
    ) {
      await action.reply(
        body('연결된 프로젝트 관리자만 이 채널에서 승인할 수 있습니다.'),
      );
      return;
    }
    let deferred = false;
    try {
      let context = this.authority(saved);
      const [, command, id, rawRevision] = action.customId.split(':');
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
      if (command === 'review' && action.kind === 'button') {
        const receipt = saved.notifications[id];
        if (!receipt || receipt.messageId !== action.messageId)
          throw Error('원본 요청 메시지에서 다시 확인해주세요.');
        const detail = await context.read(id);
        this.authority(saved);
        if (detail.item.revision !== Number(rawRevision))
          throw Error(
            '요청이 수정되었습니다. 최신 알림에서 내용을 다시 확인해주세요.',
          );
        const text = discordReviewText(detail, saved);
        const pages = text.match(/[\s\S]{1,1700}/g) || [
          '요청 내용이 없습니다.',
        ];
        this.expire();
        const key = randomUUID();
        const review: Review = {
          detail,
          pages,
          page: 0,
          expires: Date.now() + 600_000,
          commandId: randomUUID(),
          used: false,
        };
        this.reviews.set(key, review);
        await action.edit(this.reviewBody(key, review));
      } else if (command === 'page' && action.kind === 'button') {
        const review = this.review(id),
          page = Number(rawRevision);
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
        if (review.used)
          throw Error('이미 처리한 승인입니다. 요청 상태를 확인해주세요.');
        if (
          review.page !== review.pages.length - 1 ||
          !review.detail.reviewToken
        )
          throw Error('전체 요청 내용을 확인한 뒤 승인해주세요.');
        review.used = true;
        context = this.authority(saved);
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
        await action.edit(
          body(
            '승인한 버전의 AI 구현을 시작했습니다. 결과는 요청 메시지와 스레드에 반영됩니다.',
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
