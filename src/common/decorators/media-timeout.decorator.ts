import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { MediaRequestContext } from '../media-request-context';

export const MEDIA_TIMEOUT_PROFILE = 'media-timeout-profile';
export type MediaHttpRequest = FastifyRequest & {
  mediaExecution?: MediaRequestContext;
};

export const MediaTimeout = () => SetMetadata(MEDIA_TIMEOUT_PROFILE, true);

export const MediaExecution = createParamDecorator(
  (
    _data: unknown,
    context: ExecutionContext,
  ): MediaRequestContext | undefined =>
    context.switchToHttp().getRequest<MediaHttpRequest>().mediaExecution,
);
