import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { mediaAllowedOrigins } from './media-limits';

const denied = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  denied.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const)
  denied.addSubnet(address, prefix, 'ipv6');
const privateAddresses = new BlockList();
denied.addAddress('168.63.129.16', 'ipv4');
denied.addAddress('fd00:ec2::254', 'ipv6');
privateAddresses.addSubnet('10.0.0.0', 8, 'ipv4');
privateAddresses.addSubnet('172.16.0.0', 12, 'ipv4');
privateAddresses.addSubnet('192.168.0.0', 16, 'ipv4');
privateAddresses.addSubnet('fc00::', 7, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

// Normalize IPv4-mapped IPv6 before classifying it, including hexadecimal form.
function normalizedAddress(address: string): string {
  if (isIP(address) !== 6) return address;
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/i.exec(normalized);
  if (!mapped) return normalized;
  const high = parseInt(mapped[1], 16);
  const low = parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

export function isAllowedMediaAddress(
  address: string,
  allowPrivate: boolean,
): boolean {
  const normalized = normalizedAddress(address);
  const family = isIP(normalized);
  if (!family) return false;
  const type = family === 4 ? 'ipv4' : 'ipv6';
  if (denied.check(normalized, type)) return false;
  if (privateAddresses.check(normalized, type)) return allowPrivate;
  return family === 4 || globalV6.check(normalized, 'ipv6');
}

export async function abortable<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  let listener: (() => void) | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        listener = () => reject(new Error('Media preparation interrupted'));
        signal.addEventListener('abort', listener, { once: true });
      }),
    ]);
  } finally {
    if (listener) signal.removeEventListener('abort', listener);
  }
}

@Injectable()
export class MediaSourcePolicy {
  private readonly allowedOrigins: Set<string>;

  constructor(config: ConfigService) {
    this.allowedOrigins = new Set(
      mediaAllowedOrigins(config.get<string>('MEDIA_SOURCE_ALLOWED_HOSTS', '')),
    );
  }

  async resolve(
    value: string,
    signal: AbortSignal,
  ): Promise<{
    url: URL;
    address: string;
    family: number;
  }> {
    signal.throwIfAborted();
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException('Invalid media URL');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new BadRequestException(
        'Media source must be HTTP(S) without credentials',
      );
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const family = isIP(hostname);
    const records = family
      ? [{ address: hostname, family }]
      : await abortable(
          lookup(hostname, { all: true, verbatim: true }),
          signal,
        );
    signal.throwIfAborted();
    if (
      !records.length ||
      records.some(
        (record) =>
          !isAllowedMediaAddress(
            record.address,
            this.allowedOrigins.has(url.origin),
          ),
      )
    )
      throw new BadRequestException('Media source address is not allowed');
    // Use this address directly in the socket, preserving Host and TLS servername.
    return { url, ...records[0] };
  }
}
