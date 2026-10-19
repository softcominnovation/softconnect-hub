import { ConfigService } from '@nestjs/config';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  MEDIA_DEFAULT_MAX_CONCURRENT,
  MEDIA_DEFAULT_MAX_SIZE_MB,
  mediaBodyLimit,
} from './media-limits';

export const MEDIA_ADMISSION = Symbol('mediaAdmission');
export interface MediaAdmission {
  /** Transfer release responsibility to the execution's finally, including after HTTP disconnect. */
  take: () => () => void;
}
export type AdmittedMediaRequest = FastifyRequest & {
  [MEDIA_ADMISSION]?: MediaAdmission;
};

/** Install before app.init(). MID-03 wires this with preparation; never raise bodyLimit alone. */
export function installMediaHttpAdmission(
  server: FastifyInstance,
  config: ConfigService,
): void {
  const limit = config.get<number>(
    'MEDIA_MAX_CONCURRENT',
    MEDIA_DEFAULT_MAX_CONCURRENT,
  );
  const bodyLimit = mediaBodyLimit(
    config.get<number>('MEDIA_MAX_SIZE_MB', MEDIA_DEFAULT_MAX_SIZE_MB),
  );
  const uploadTimeout = config.get<number>('MEDIA_REQUEST_TIMEOUT_MS', 900000);
  let active = 0;
  server.addHook('onRoute', (route) => {
    if (
      route.method !== 'POST' ||
      !/^(?:\/api\/v1)?\/message\/(?:sendMedia|sendDocument|sendSticker)\/:instanceId$/.test(
        route.url,
      )
    )
      return;
    route.bodyLimit = bodyLimit;
    const admission: NonNullable<typeof route.onRequest> = (
      request: AdmittedMediaRequest,
      reply,
      done,
    ) => {
      if (active >= limit) {
        void reply.code(503).send({
          statusCode: 503,
          error: 'SERVICE_UNAVAILABLE',
          message: 'Media capacity temporarily unavailable',
        });
        return;
      }
      active += 1;
      let released = false;
      let adopted = false;
      const release = () => {
        if (released) return;
        released = true;
        active -= 1;
        clearTimeout(timer);
        request.raw.removeListener('aborted', end);
        reply.raw.removeListener('close', end);
        reply.raw.removeListener('finish', end);
      };
      const end = () => {
        if (!adopted) release();
      };
      const timer = setTimeout(() => {
        if (!adopted) {
          // Stop parsing/retaining a body that continues arriving after the timeout.
          reply.raw.once('finish', () => request.raw.destroy());
          void reply.header('connection', 'close').code(408).send({
            statusCode: 408,
            error: 'REQUEST_TIMEOUT',
            message: 'Request timeout',
          });
          release();
        }
      }, uploadTimeout);
      request[MEDIA_ADMISSION] = {
        take: () => {
          adopted = true;
          clearTimeout(timer);
          return release;
        },
      };
      request.raw.once('aborted', end);
      reply.raw.once('close', end);
      reply.raw.once('finish', end);
      if (request.raw.aborted || reply.raw.destroyed) release();
      done();
    };
    route.onRequest = [
      admission,
      ...(Array.isArray(route.onRequest)
        ? route.onRequest
        : route.onRequest
          ? [route.onRequest]
          : []),
    ];
    const previous = route.errorHandler;
    route.errorHandler = function (error, request, reply) {
      if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
        void reply.code(413).send({
          statusCode: 413,
          error: 'PAYLOAD_TOO_LARGE',
          message: 'Request body is too large',
        });
      } else if (previous) previous.call(this, error, request, reply);
      else void reply.send(error);
    };
  });
}
