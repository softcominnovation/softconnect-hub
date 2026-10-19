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
import type { MediaSourceDiagnostics } from '../../common/media-request-context';

export interface MediaSource {
  stream: Readable;
  contentType?: string;
  contentLength?: number;
}

@Injectable()
export class MediaSourceClient {
  constructor(private readonly policy: MediaSourcePolicy) {}

  async open(
    value: string,
    signal: AbortSignal,
    diagnostics: MediaSourceDiagnostics = {},
  ): Promise<MediaSource> {
    try {
      return await this.openSource(value, signal, diagnostics);
    } catch (error) {
      this.recordError(diagnostics, error);
      throw error;
    }
  }

  private recordError(
    diagnostics: MediaSourceDiagnostics,
    error: unknown,
  ): void {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    // Keep only bounded error identifiers, never exception messages or URLs.
    if (
      !diagnostics.errorCode &&
      typeof code === 'string' &&
      /^[A-Z][A-Z0-9_]{0,63}$/.test(code)
    )
      diagnostics.errorCode = code;
  }

  private async openSource(
    value: string,
    signal: AbortSignal,
    diagnostics: MediaSourceDiagnostics,
  ): Promise<MediaSource> {
    let current = value;
    for (let redirects = 0; redirects <= 5; redirects++) {
      diagnostics.stage = 'resolve';
      diagnostics.host = undefined;
      diagnostics.statusCode = undefined;
      diagnostics.errorCode = undefined;
      try {
        diagnostics.host = new URL(current).hostname;
      } catch {
        // Let the existing policy produce the unchanged public validation error.
      }
      const target = await this.policy.resolve(current, signal);
      diagnostics.stage = 'request';
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
          response.on('error', (error) => this.recordError(diagnostics, error));
          resolve(response);
        });
        request.once('error', reject);
        request.end();
      });
      const status = response.statusCode ?? 0;
      diagnostics.statusCode = status;
      diagnostics.stage = 'response';
      if ([301, 302, 303, 307, 308].includes(status)) {
        diagnostics.stage = 'redirect';
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
        diagnostics.errorCode = 'HTTP_STATUS';
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
        diagnostics.stage = 'decode';
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
        decoder.on('error', (error) => {
          // Pipeline also forwards socket/cancellation errors; those are not decoding failures.
          if ((error as NodeJS.ErrnoException).code?.startsWith('Z_'))
            diagnostics.stage = 'decode';
          this.recordError(diagnostics, error);
        });
        stream = decoder;
      }
      diagnostics.stage = 'download';
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
