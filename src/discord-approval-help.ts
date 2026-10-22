export const DISCORD_HELP_URLS = {
  portal: 'https://discord.com/developers/applications',
  permissions: 'https://docs.discord.com/developers/topics/permissions',
  ids: 'https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID',
} as const;

export type DiscordHelpPage = keyof typeof DISCORD_HELP_URLS;

export function discordHelpUrl(page: unknown): string {
  if (typeof page !== 'string' || !Object.hasOwn(DISCORD_HELP_URLS, page))
    throw Error('지원하지 않는 디스코드 도움말입니다.');
  return DISCORD_HELP_URLS[page as DiscordHelpPage];
}
