import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { setImmediate } from 'node:timers/promises';
import { MediaRequestContext } from '../../common/media-request-context';

const CHUNK = 64 * 1024;
const compact = (value: string) => value.replace(/[\t\n\r ]/g, '');

export async function inspectBase64(
  value: string,
  maxBytes: number,
  execution: MediaRequestContext,
): Promise<{
  offset: number;
  bytes: number;
  mimeType?: string;
}> {
  let offset = 0;
  let mimeType: string | undefined;
  if (value.startsWith('data:')) {
    offset = value.indexOf(',') + 1;
    if (!offset || offset > 1024)
      throw new BadRequestException('Invalid media data URI');
    const match =
      /^data:([\w!#$&^.+-]+\/[\w!#$&^.+-]+)?(?:;charset=[\w-]+)?;base64,$/i.exec(
        value.slice(0, offset),
      );
    if (!match) throw new BadRequestException('Invalid media data URI');
    mimeType = match[1];
  }
  let length = 0;
  let padding = 0;
  let padded = false;
  let tail = '';
  for (let i = offset; i < value.length; i += CHUNK) {
    execution.assertActive();
    const part = compact(value.slice(i, i + CHUNK));
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(part) || (padded && /[^=]/.test(part)))
      throw new BadRequestException('Invalid media base64');
    const equals = part.indexOf('=');
    if (equals >= 0) {
      padding += part.length - equals;
      padded = true;
    }
    length += part.length;
    tail = (tail + part).slice(-4);
    if (Math.floor(((length - padding) * 3) / 4) > maxBytes)
      throw new PayloadTooLargeException('Media exceeds configured size limit');
    if ((i - offset) % (16 * CHUNK) === 0) await setImmediate();
  }
  const useful = length - padding;
  const bytes = Math.floor((useful * 3) / 4);
  if (
    !length ||
    padding > 2 ||
    useful % 4 === 1 ||
    (padding > 0 && length % 4 !== 0) ||
    (padding && padding !== (4 - (useful % 4)) % 4)
  )
    throw new BadRequestException('Invalid media base64');
  const final = useful % 4 ? tail.slice(-((useful % 4) + padding)) : tail;
  if (
    Buffer.from(final, 'base64').toString('base64').replace(/=+$/, '') !==
    final.replace(/=+$/, '')
  )
    throw new BadRequestException('Invalid media base64 padding');
  return { offset, bytes, mimeType };
}

export function* decodedBase64(
  value: string,
  offset: number,
  execution: MediaRequestContext,
): Generator<Buffer> {
  let carry = '';
  for (let i = offset; i < value.length; i += CHUNK) {
    execution.assertActive();
    const part = carry + compact(value.slice(i, i + CHUNK));
    const aligned = part.length - (part.length % 4);
    if (aligned) yield Buffer.from(part.slice(0, aligned), 'base64');
    carry = part.slice(aligned);
  }
  if (carry) yield Buffer.from(carry, 'base64');
}
