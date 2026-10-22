import { BlockList, isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

/** Only peel addresses from the right through operator-owned proxy CIDRs. */
export function createPeerIdentity(cidrs: readonly string[] = []) {
  const trusted = new BlockList();
  const normalize = (ip: string) =>
    ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, '$1');
  for (const value of cidrs) {
    const [raw, prefix, ...extra] = value.split('/');
    const ip = normalize(raw),
      version = isIP(ip),
      max = version === 4 ? 32 : 128;
    if (
      !version ||
      extra.length ||
      (prefix !== undefined && (!/^\d+$/.test(prefix) || +prefix > max))
    )
      throw new Error('GAMEJAM_TRUSTED_PROXIES의 IP/CIDR가 올바르지 않습니다.');
    trusted.addSubnet(
      ip,
      prefix === undefined ? max : +prefix,
      version === 4 ? 'ipv4' : 'ipv6',
    );
  }
  const isTrusted = (ip: string) => {
    const version = isIP(ip);
    return !!version && trusted.check(ip, version === 4 ? 'ipv4' : 'ipv6');
  };
  return (request: IncomingMessage) => {
    let peer = normalize(request.socket.remoteAddress ?? 'unknown');
    const header = request.headers['x-forwarded-for'];
    if (!isTrusted(peer) || typeof header !== 'string' || header.length > 2048)
      return peer;
    const chain = header.split(',').map((value) => normalize(value.trim()));
    if (chain.length > 16 || chain.some((value) => !isIP(value))) return peer;
    for (let i = chain.length - 1; i >= 0 && isTrusted(peer); i--)
      peer = chain[i];
    return peer;
  };
}
