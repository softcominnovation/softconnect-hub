import { GatewayTimeoutException } from '@nestjs/common';

export const SEND_PROVIDER_TIMEOUT_DEFAULT_MS = 600000;
export const SEND_SAFETY_TIMEOUT_MESSAGE =
  'Limite de segurança atingido sem resposta da Evolution. Resultado do envio não confirmado.';

export class SendSafetyTimeoutException extends GatewayTimeoutException {
  constructor() {
    super(SEND_SAFETY_TIMEOUT_MESSAGE);
  }
}
