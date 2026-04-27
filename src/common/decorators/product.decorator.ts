import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthCachePayload } from '../../auth/apikey.guard';

export const Product = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthCachePayload => {
    const request = ctx.switchToHttp().getRequest<{ product: AuthCachePayload }>();
    return request.product;
  },
);
