import { constants } from 'node:buffer';

export const MEDIA_DEFAULT_MAX_SIZE_MB = 50;
export const MEDIA_DEFAULT_MAX_CONCURRENT = 2;
export const MEDIA_JSON_MARGIN_BYTES = 1024 * 1024;
// JSON is parsed as a string by Fastify. Reject configurations it cannot represent.
export const MEDIA_MAX_CONFIG_SIZE_MB = Math.floor(
  ((constants.MAX_STRING_LENGTH - MEDIA_JSON_MARGIN_BYTES - 4) * 3) /
    4 /
    1000000,
);

export function mediaMaxBytes(sizeMb: number): number {
  return sizeMb * 1000000;
}

export function mediaBodyLimit(sizeMb: number): number {
  return 4 * Math.ceil(mediaMaxBytes(sizeMb) / 3) + MEDIA_JSON_MARGIN_BYTES;
}

export function mediaAllowedOrigins(value: string): string[] {
  if (!value.trim()) return [];
  return value.split(',').map((entry) => {
    const url = new URL(entry.trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error('Use exact HTTP(S) origins without credentials or paths');
    return url.origin;
  });
}
