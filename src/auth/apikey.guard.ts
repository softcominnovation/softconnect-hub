import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { hashSHA256 } from '../common/crypto.util';
import { PrismaService } from '../prisma/prisma.service';

export interface AuthCachePayload {
  productId: string;
  apiKeyHash: string;
  isActive: boolean;
  origins: string[];
  hubRelay: boolean;
  adapterType: string;
  vpsId: string | null;
  batchWebhookEnabled: boolean;
  batchWebhookUrl: string | null;
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly cache: CacheService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Record<string, unknown>>();
    const apiKey = (request.headers as Record<string, string>)['apikey'];

    if (!apiKey) throw new UnauthorizedException('API Key ausente');

    const hash = hashSHA256(apiKey);
    const cacheKey = `auth:${hash}`;

    let payload = await this.cache.get<AuthCachePayload>(cacheKey);

    if (!payload) {
      const product = await this.prisma.product.findUnique({
        where: { apiKeyHash: hash },
        select: {
          id: true,
          isActive: true,
          origins: true,
          hubRelay: true,
          adapterType: true,
          vpsId: true,
          batchWebhookEnabled: true,
          batchWebhookUrl: true,
        },
      });

      if (!product) throw new UnauthorizedException('API Key inválida');

      payload = {
        productId: product.id,
        apiKeyHash: hash,
        isActive: product.isActive,
        origins: product.origins,
        hubRelay: product.hubRelay,
        adapterType: product.adapterType,
        vpsId: product.vpsId,
        batchWebhookEnabled: product.batchWebhookEnabled,
        batchWebhookUrl: product.batchWebhookUrl,
      };

      await this.cache.setWithTTL(cacheKey, payload, 60);
    }

    if (!payload.isActive) throw new UnauthorizedException('Produto inativo');

    request.product = payload;
    return true;
  }
}
