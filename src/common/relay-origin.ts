import { isIP } from 'node:net';

export interface RelayRequestOrigin {
  ip?: string;
  raw?: { socket?: { remoteAddress?: string } };
  headers: Record<string, string | string[] | undefined>;
}

export function relaySourceIp(
  request: RelayRequestOrigin,
  trustedProxyIps = '',
): string {
  const normalize = (ip: string) =>
    ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const trusted = new Set(
    trustedProxyIps
      .split(',')
      .map((ip) => normalize(ip.trim()))
      .filter(Boolean),
  );
  let source = normalize(
    request.raw?.socket?.remoteAddress ?? request.ip ?? '',
  );
  if (!isIP(source)) return '';
  // Forwarded headers are authority only behind explicitly trusted immediate peers.
  if (trusted.has(source)) {
    const header = request.headers['x-forwarded-for'];
    if (typeof header !== 'string') return '';
    const chain = header.split(',').map((ip) => normalize(ip.trim()));
    if (!chain.length || chain.some((ip) => !isIP(ip))) return '';
    for (let i = chain.length - 1; i >= 0 && trusted.has(source); i--)
      source = chain[i];
  }
  return source;
}
