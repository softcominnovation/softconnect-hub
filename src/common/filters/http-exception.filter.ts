import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.message
        : 'Internal server error';

    const details =
      exception instanceof HttpException
        ? (exception.getResponse() as Record<string, unknown>)?.message
        : undefined;

    void response.status(status).send({
      statusCode: status,
      error: HttpStatus[status] ?? 'Error',
      message,
      ...(details && details !== message ? { details } : {}),
    });
  }
}
