import { HttpException } from '@nestjs/common';

/** Preserve the provider's error body, including its fields and original status. */
export class ProviderResponseException extends HttpException {
  constructor(
    readonly providerBody: unknown,
    status: number,
  ) {
    super(providerBody as string | Record<string, unknown>, status);
    const body =
      providerBody && typeof providerBody === 'object'
        ? (providerBody as Record<string, unknown>)
        : undefined;
    const detail = body?.message ?? body?.error ?? providerBody;
    this.message =
      typeof detail === 'string' && detail.length
        ? detail
        : detail !== undefined && detail !== null && detail !== ''
          ? JSON.stringify(detail)
          : `Evolution respondeu HTTP ${status} sem corpo de erro.`;
  }
}
