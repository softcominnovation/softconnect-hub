import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { SendRequestContext } from '../send-request-context';

export const SEND_RESPONSE_PROFILE = 'send-provider-response';
export type SendHttpRequest = FastifyRequest & {
  sendExecution?: SendRequestContext;
};
export const ProviderResponse = () => SetMetadata(SEND_RESPONSE_PROFILE, true);
export const SendExecution = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SendRequestContext | undefined =>
    context.switchToHttp().getRequest<SendHttpRequest>().sendExecution,
);
