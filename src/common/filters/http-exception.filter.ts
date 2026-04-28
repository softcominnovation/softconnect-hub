import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (!(exception instanceof HttpException)) {
      const axiosResponse = (exception as Record<string, unknown>)?.response;
      const axiosData =
        axiosResponse && typeof axiosResponse === 'object'
          ? JSON.stringify((axiosResponse as Record<string, unknown>)?.data)
          : undefined;
      this.logger.error(
        exception instanceof Error ? exception.message : String(exception),
        exception instanceof Error ? exception.stack : undefined,
      );
      if (axiosData) this.logger.error(`Provider response body: ${axiosData}`);
    }
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'object' && body !== null && !('statusCode' in body)) {
        void response.status(status).send(body);
        return;
      }

      const message =
        typeof body === 'string' ? body : (body as Record<string, unknown>).message ?? exception.message;
      const details =
        typeof body === 'object' ? (body as Record<string, unknown>).message : undefined;

      void response.status(status).send({
        statusCode: status,
        error: HttpStatus[status] ?? 'Error',
        message,
        ...(details && details !== message ? { details } : {}),
      });
      return;
    }

    const axiosResponse = (exception as Record<string, unknown>)?.response;
    const axiosData =
      axiosResponse && typeof axiosResponse === 'object'
        ? JSON.stringify((axiosResponse as Record<string, unknown>)?.data)
        : undefined;
    this.logger.error(
      exception instanceof Error ? exception.message : String(exception),
      exception instanceof Error ? exception.stack : undefined,
    );
    if (axiosData) this.logger.error(`Provider response body: ${axiosData}`);

    void response.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    });
  }
}
