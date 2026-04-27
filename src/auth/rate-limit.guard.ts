import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../cache/cache.service';
import { AuthCachePayload } from './apikey.guard';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly limit: number;

  constructor(
    private readonly cache: CacheService,
    private readonly config: ConfigService,
  ) {
    this.limit = this.config.get<number>('DEFAULT_RATE_LIMIT', 100);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ product: AuthCachePayload }>();

    const product = request.product;
    if (!product) return true;

    const key = `rate:${product.productId}`;
    const current = await this.cache.increment(key, 1);

    if (current === 1) {
      await this.cache.expire(key, 1);
    }

    if (current > this.limit) {
      throw new HttpException(
        'Rate limit excedido',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
