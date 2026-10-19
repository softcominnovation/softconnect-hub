import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MediaRequestContext } from '../../common/media-request-context';
import { decodedBase64, inspectBase64 } from './media-base64';
import { MEDIA_DEFAULT_MAX_SIZE_MB, mediaMaxBytes } from './media-limits';
import { MediaSourceClient } from './media-source.client';
import { MediaTempStore } from './media-temp-store';
import { MediaField, PreparedMedia } from './prepared-media';

// Match the reference Evolution URL defaults before replacing the URL with base64.
export function evolutionMediaDefaults(
  payload: Record<string, unknown>,
  field: MediaField,
  sourceUrl?: string,
  contentType?: string,
): Record<string, string> {
  if (field === 'sticker') return {};
  const defaults: Record<string, string> = {};
  if (sourceUrl && !payload.fileName) {
    if (payload.mediatype === 'image') defaults.fileName = 'image.jpg';
    else if (payload.mediatype === 'video') defaults.fileName = 'video.mp4';
    else if (payload.mediatype === 'document') {
      // The reference Evolution removes the extension when inferring a document name.
      const name = /.*\/(.+?)\./.exec(sourceUrl)?.[1];
      if (name) defaults.fileName = name;
    }
  }
  if (!payload.mimetype && contentType) defaults.mimetype = contentType;
  return defaults;
}

@Injectable()
export class MediaPreparationService {
  private readonly maxBytes: number;

  constructor(
    config: ConfigService,
    private readonly sources: MediaSourceClient,
    private readonly files: MediaTempStore,
  ) {
    this.maxBytes = mediaMaxBytes(
      config.get<number>('MEDIA_MAX_SIZE_MB', MEDIA_DEFAULT_MAX_SIZE_MB),
    );
  }

  async prepare(
    payload: Record<string, unknown>,
    field: MediaField,
    execution: MediaRequestContext,
  ): Promise<PreparedMedia> {
    execution.assertActive();
    const value = payload[field];
    const timeoutMs = execution.callTimeout(execution.downloadTimeoutMs);
    const reason =
      timeoutMs < execution.downloadTimeoutMs
        ? 'request_timeout'
        : 'download_timeout';
    const deadline = performance.now() + timeoutMs;
    const startedAt = performance.now();
    execution.preparationStartedAt = startedAt;
    const timer = setTimeout(() => execution.abort(reason), timeoutMs);
    let temp: Awaited<ReturnType<MediaTempStore['create']>> | undefined;
    let source: Readable | undefined;
    try {
      if (typeof value !== 'string' || !value.length)
        throw new BadRequestException(`Invalid ${field}`);
      const url = /^https?:\/\//i.test(value) ? value : undefined;
      let contentType: string | undefined;
      if (url) {
        const remote = await this.sources.open(url, execution.signal);
        source = remote.stream;
        contentType = remote.contentType;
        if (
          remote.contentLength !== undefined &&
          remote.contentLength > this.maxBytes
        )
          throw new PayloadTooLargeException(
            'Media exceeds configured size limit',
          );
      } else {
        const base64 = await inspectBase64(value, this.maxBytes, execution);
        contentType = base64.mimeType;
        source = Readable.from(decodedBase64(value, base64.offset, execution), {
          objectMode: false,
        });
      }
      execution.assertActive();
      temp = await this.files.create();
      let bytes = 0;
      const maxBytes = this.maxBytes;
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          try {
            execution.assertActive();
            bytes += chunk.length;
            if (bytes > maxBytes)
              throw new PayloadTooLargeException(
                'Media exceeds configured size limit',
              );
            callback(null, chunk);
          } catch (error) {
            callback(error as Error);
          }
        },
      });
      await pipeline(
        source,
        counter,
        createWriteStream(temp.path, {
          flags: 'wx',
          mode: 0o600,
          highWaterMark: 64 * 1024,
        }),
        { signal: execution.signal },
      );
      if (performance.now() >= deadline) execution.abort(reason);
      execution.assertActive();
      if (!bytes) throw new BadRequestException('Empty media file');
      execution.mediaBytes = bytes;
      return new PreparedMedia(
        temp.path,
        bytes,
        field,
        evolutionMediaDefaults(payload, field, url, contentType),
        temp.dispose,
        execution.signal,
      );
    } catch (error) {
      execution.failureSource =
        error instanceof PayloadTooLargeException
          ? 'size_limit'
          : 'preparation_error';
      source?.destroy();
      await temp?.dispose();
      execution.assertActive();
      if (error instanceof HttpException) throw error;
      if (
        ['ENOSPC', 'EACCES', 'EROFS', 'EMFILE'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )
      )
        throw new ServiceUnavailableException(
          'Media temporary storage unavailable',
        );
      throw new BadGatewayException('Unable to prepare media');
    } finally {
      execution.preparationMs = Math.round(performance.now() - startedAt);
      clearTimeout(timer);
    }
  }
}
