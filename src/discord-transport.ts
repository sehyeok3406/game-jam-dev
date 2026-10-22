import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Routes,
  type APIMessage,
  type APIChannel,
  type APITextChannel,
  type RESTPostAPIChannelMessageJSONBody,
} from 'discord.js';

export type DiscordMessage = RESTPostAPIChannelMessageJSONBody & {
  files?: { name: string; data: Buffer }[];
};
export type DiscordAction = {
  id: string;
  customId: string;
  userId: string;
  channelId: string;
  messageId?: string;
  kind: 'button' | 'modal';
  feedback?: string;
  defer(): Promise<void>;
  reply(body: DiscordMessage): Promise<void>;
  edit(body: DiscordMessage): Promise<void>;
  modal(id: string): Promise<void>;
};
export interface DiscordTransport {
  connect(token: string, channelId: string, threads: boolean): Promise<void>;
  close(): void;
  ready(): boolean;
  send(channelId: string, body: DiscordMessage): Promise<string>;
  update(
    channelId: string,
    messageId: string,
    body: DiscordMessage,
  ): Promise<void>;
  thread(channelId: string, messageId: string, name: string): Promise<string>;
}

/** discord.js owns heartbeat, resume, reconnect, and REST rate-limit handling. */
export class DiscordBotTransport implements DiscordTransport {
  private client = new Client({
    intents: [GatewayIntentBits.Guilds],
    rest: { timeout: 15_000 },
  });
  constructor(
    action: (value: DiscordAction) => Promise<void>,
    failure: () => void,
  ) {
    this.client.on(Events.Error, failure);
    this.client.on(Events.ShardError, failure);
    this.client.on(Events.InteractionCreate, (i) => {
      if (
        (!i.isButton() && !i.isModalSubmit()) ||
        !i.channelId ||
        !i.customId.startsWith('gj:')
      )
        return;
      const value: DiscordAction = {
        id: i.id,
        customId: i.customId,
        userId: i.user.id,
        channelId: i.channelId,
        messageId: i.message?.id,
        kind: i.isButton() ? 'button' : 'modal',
        feedback:
          i.isModalSubmit() && i.fields.fields.has('feedback')
            ? i.fields.getTextInputValue('feedback')
            : undefined,
        defer: async () => {
          await i.deferReply({ flags: MessageFlags.Ephemeral });
        },
        reply: async (body) => {
          await i.reply({
            ...body,
            flags: MessageFlags.Ephemeral,
          } as Parameters<typeof i.reply>[0]);
        },
        edit: async (body) => {
          await i.editReply(body as Parameters<typeof i.editReply>[0]);
        },
        modal: async (id) => {
          if (!i.isButton()) return;
          await i.showModal({
            custom_id: id,
            title: '보완 요청',
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 4,
                    custom_id: 'feedback',
                    label: '요청자에게 전달할 보완 의견',
                    style: 2,
                    required: true,
                    max_length: 4000,
                  },
                ],
              },
            ],
          });
        },
      };
      void action(value).catch(failure);
    });
  }
  async connect(token: string, channelId: string, threads: boolean) {
    let dispose = () => {};
    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(Error('연결 시간 초과'));
      }, 25_000);
      const done = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(timeout);
        this.client.off(Events.ClientReady, done);
      };
      dispose = cleanup;
      this.client.once(Events.ClientReady, done);
    });
    try {
      await Promise.all([this.client.login(token), ready]);
    } finally {
      dispose();
    }
    const channel = (await this.client.rest.get(
      Routes.channel(channelId),
    )) as APIChannel;
    if (channel.type !== 0 || !('guild_id' in channel) || !channel.guild_id)
      throw Error('서버의 일반 텍스트 채널을 선택해주세요.');
    const cached = await this.client.channels.fetch(channelId);
    if (!cached || !('permissionsFor' in cached))
      throw Error('채널 접근 권한을 확인해주세요.');
    const permissions = cached.permissionsFor(this.client.user!);
    if (
      !permissions?.has([
        'ViewChannel',
        'SendMessages',
        'EmbedLinks',
        'ReadMessageHistory',
      ])
    )
      throw Error(
        '채널 보기·메시지 보내기·링크 첨부·메시지 기록 보기 권한을 확인해주세요.',
      );
    if (
      threads &&
      !permissions.has(['CreatePublicThreads', 'SendMessagesInThreads'])
    )
      throw Error(
        '공개 스레드 만들기·스레드에서 메시지 보내기 권한을 확인해주세요.',
      );
  }
  ready() {
    return this.client.isReady();
  }
  close() {
    void this.client.destroy();
  }
  async send(channelId: string, body: DiscordMessage) {
    const { files, ...json } = body;
    const result = (await this.client.rest.post(
      Routes.channelMessages(channelId),
      { body: json, files },
    )) as APIMessage;
    return result.id;
  }
  async update(channelId: string, messageId: string, body: DiscordMessage) {
    const { files, ...json } = body;
    await this.client.rest.patch(Routes.channelMessage(channelId, messageId), {
      body: json,
      files,
    });
  }
  async thread(channelId: string, messageId: string, name: string) {
    const result = (await this.client.rest.post(
      Routes.threads(channelId, messageId),
      {
        body: { name: name.slice(0, 100), auto_archive_duration: 1440 },
      },
    )) as APITextChannel;
    return result.id;
  }
}
