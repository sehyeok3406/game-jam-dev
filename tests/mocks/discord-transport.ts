import type {
  DiscordAction,
  DiscordMessage,
} from '../../src/discord-transport';
export let discordMock: DiscordBotTransport;
export class DiscordBotTransport {
  connected = false;
  messages: { id: string; channelId: string; body: DiscordMessage }[] = [];
  private action: (value: DiscordAction) => Promise<void>;
  constructor(action: (value: DiscordAction) => Promise<void>) {
    this.action = action;
    discordMock = this;
  }
  async connect() {
    this.connected = true;
  }
  close() {
    this.connected = false;
  }
  ready() {
    return this.connected;
  }
  async send(channelId: string, body: DiscordMessage) {
    const id = `mock-message-${this.messages.length}`;
    this.messages.push({ id, channelId, body });
    return id;
  }
  async update(channelId: string, id: string, body: DiscordMessage) {
    const message = this.messages.find(
      (m) => m.id === id && m.channelId === channelId,
    );
    if (!message) throw Error('Missing mock message');
    message.body = body;
  }
  async thread() {
    return 'mock-thread';
  }
  click(
    customId: string,
    userId: string,
    channelId: string,
    messageId?: string,
  ) {
    const replies: DiscordMessage[] = [];
    const action: DiscordAction = {
      id: crypto.randomUUID(),
      customId,
      userId,
      channelId,
      messageId,
      kind: 'button',
      async defer() {},
      async reply(value) {
        replies.push(value);
      },
      async edit(value) {
        replies.push(value);
      },
      async modal() {},
    };
    return this.action(action).then(() => replies);
  }
}
