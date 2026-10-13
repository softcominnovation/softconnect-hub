import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { QrRequestContext } from '../qr-request-context';

export const QR_TIMEOUT_PROFILE = 'qr-timeout-profile';
export type QrTimeoutProfile = 'connect' | 'create';
export type QrHttpRequest = FastifyRequest & {
  qrExecution?: QrRequestContext;
};

export const QrTimeout = (profile: QrTimeoutProfile) =>
  SetMetadata(QR_TIMEOUT_PROFILE, profile);

export const QrExecution = createParamDecorator(
  (_data: unknown, context: ExecutionContext): QrRequestContext | undefined =>
    context.switchToHttp().getRequest<QrHttpRequest>().qrExecution,
);
