import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { request as httpRequest, IncomingMessage } from 'node:http';
import { request as httpsRequest, RequestOptions } from 'node:https';
import { isIP } from 'node:net';
import { Readable, pipeline } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { MediaSourcePolicy } from './media-source-policy';

export interface MediaSource {
  stream: Readable;
  contentType?: string;
  contentLength?: number;
}

@Injectable()
export class MediaSourceClient {
  constructor(private readonly policy: MediaSourcePolicy) {}

  async open(value: string, signal: AbortSignal): Promise<MediaSource> {
    let current = value;
    for (let redirects = 0; redirects <= 5; redirects++) {
      const target = await this.policy.resolve(current, signal);
      const response = await new Promise<IncomingMessage>((resolve, reject) => {
        const transport =
          target.url.protocol === 'https:' ? httpsRequest : httpRequest;
        const hostname = target.url.hostname.replace(/^\[|\]$/g, '');
        const options: RequestOptions = {
          hostname: target.address,
          family: target.family,
          servername: isIP(hostname) ? undefined : hostname,
          agent: false,
          signal,
          headers: {
            Host: target.url.host,
            Accept: '*/*',
            'Accept-Encoding': 'gzip, deflate, br',
          },
        };
        const request = transport(target.url, options, (response) => {
          // A connection may fail while the caller is opening its temporary file.
          // Keep the stream error observed; pipeline still receives the same error.
          response.on('error', () => undefined);
          resolve(response);
        });
        request.once('error', reject);
        request.end();
      });
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.destroy();
        const location = response.headers.location;
        if (!location || redirects === 5)
          throw new BadGatewayException('Media source redirect limit exceeded');
        const next = new URL(location, target.url);
        if (target.url.protocol === 'https:' && next.protocol !== 'https:')
          throw new BadRequestException(
            'Media source redirect downgrades HTTPS',
          );
        current = next.href;
        continue;
      }
      if (status !== 200) {
        response.destroy();
        throw new BadGatewayException(
          'Media source did not return a complete file',
        );
      }
      const encoding = response.headers['content-encoding']
        ?.trim()
        .toLowerCase();
      let stream: Readable = response;
      if (encoding && encoding !== 'identity') {
        const decoder =
          encoding === 'gzip'
            ? createGunzip()
            : encoding === 'deflate'
              ? createInflate()
              : encoding === 'br'
                ? createBrotliDecompress()
                : undefined;
        if (!decoder) {
          response.destroy();
          throw new BadGatewayException('Unsupported media source encoding');
        }
        // Pipeline connects destruction/errors in both directions; decoded bytes are limited by the caller.
        pipeline(response, decoder, () => undefined);
        stream = decoder;
      }
      return {
        stream,
        contentType: response.headers['content-type'],
        contentLength:
          !encoding || encoding === 'identity'
            ? Number(response.headers['content-length']) || undefined
            : undefined,
      };
    }
    throw new BadGatewayException('Media source redirect limit exceeded');
  }
}
