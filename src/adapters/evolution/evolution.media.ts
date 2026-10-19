import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MEDIA_TIMEOUT_DEFAULTS,
  MediaRequestContext,
} from '../../common/media-request-context';
import { MediaPreparationService } from '../../modules/media/media-preparation.service';
import { MediaField, PreparedMedia } from '../../modules/media/prepared-media';
import {
  ProviderContext,
  MessageResponseDto,
} from '../../providers/whatsapp-provider.interface';
import { EvolutionHttpService } from './evolution.http';

@Injectable()
export class EvolutionMediaService {
  private readonly logger = new Logger(EvolutionMediaService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly preparation: MediaPreparationService,
    private readonly http: EvolutionHttpService,
  ) {}

  async send(
    ctx: ProviderContext,
    instanceName: string,
    payload: Record<string, unknown>,
    field: MediaField,
  ): Promise<MessageResponseDto> {
    const execution =
      ctx.mediaExecution ??
      new MediaRequestContext(
        this.config.get<number>(
          'MEDIA_REQUEST_TIMEOUT_MS',
          MEDIA_TIMEOUT_DEFAULTS.request,
        ),
        this.config.get<number>(
          'MEDIA_PROVIDER_TIMEOUT_MS',
          MEDIA_TIMEOUT_DEFAULTS.provider,
        ),
        this.config.get<number>(
          'MEDIA_DOWNLOAD_TIMEOUT_MS',
          MEDIA_TIMEOUT_DEFAULTS.download,
        ),
      );
    const timer = setTimeout(
      () => execution.abort('request_timeout'),
      execution.remainingMs,
    );
    let prepared: PreparedMedia | undefined;
    let statusCode = 201;
    try {
      prepared = await this.preparation.prepare(payload, field, execution);
      return await this.http.requestMedia<MessageResponseDto>(
        ctx.providerUrl,
        ctx.providerApiKey,
        `/message/${field === 'sticker' ? 'sendSticker' : 'sendMedia'}/${instanceName}`,
        payload,
        execution,
        prepared,
      );
    } catch (error) {
      statusCode = error instanceof HttpException ? error.getStatus() : 500;
      throw error;
    } finally {
      clearTimeout(timer);
      await prepared?.dispose();
      // HTTP executions are logged by the interceptor; batch has no HTTP observer.
      if (!ctx.mediaExecution)
        this.logger.log(
          JSON.stringify({
            event: 'media_request_finished',
            route: 'batch',
            type:
              field === 'sticker'
                ? 'sticker'
                : typeof payload.mediatype === 'string' &&
                    ['image', 'video', 'audio', 'document'].includes(
                      payload.mediatype,
                    )
                  ? payload.mediatype
                  : 'media',
            durationMs: Math.round(execution.elapsedMs),
            timeoutMs: execution.timeoutMs,
            ...execution.diagnostics(),
            upstreamStatusCode: execution.upstreamStatusCode,
            statusCode,
            source:
              execution.reason ?? execution.failureSource ?? 'upstream_success',
          }),
        );
    }
  }
}
