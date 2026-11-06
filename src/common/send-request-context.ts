import { HttpException } from '@nestjs/common';
import { MediaRequestContext, MediaStopReason } from './media-request-context';

export class SendInterruptedException extends HttpException {
  constructor(readonly reason: MediaStopReason) {
    super('A conexão do cliente foi encerrada.', 499);
  }
}

/** Preparation is independent of the provider's send safety deadline. */
export class SendRequestContext extends MediaRequestContext {
  constructor() {
    super(Infinity, 0, 0, 0);
  }

  override timeoutException(reason: MediaStopReason): HttpException {
    if (reason !== 'client_disconnected') return super.timeoutException(reason);
    return new SendInterruptedException(reason);
  }
}
