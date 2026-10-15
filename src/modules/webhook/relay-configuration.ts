import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptAES256GCM, encryptAES256GCM } from '../../common/crypto.util';
import type {
  InstanceDefaultWebhookConfig,
  WebhookPayloadDto,
} from '../../providers/whatsapp-provider.interface';

export const RELAY_TOKEN_HEADER = 'X-Hub-Relay-Token';

export function relayBaseUrl(config: ConfigService): string {
  const base = config
    .get<string>('HUB_BASE_URL', 'http://localhost:3000')
    .replace(/\/+$/, '');
  return base.endsWith('/api/v1') ? base : `${base}/api/v1`;
}

/** A single installation secret is reused by all linked products. No remote calls. */
export async function relayWebhook(
  prisma: PrismaService,
  config: ConfigService,
  providerId: string,
  webhook: InstanceDefaultWebhookConfig,
): Promise<WebhookPayloadDto> {
  const key = config.getOrThrow<string>('ENCRYPTION_KEY');
  let provider = await prisma.vpsProvider.findUniqueOrThrow({
    where: { id: providerId },
  });
  if (!provider.callbackTokenEncrypted) {
    await prisma.vpsProvider.updateMany({
      where: { id: providerId, callbackTokenEncrypted: null },
      data: {
        callbackTokenEncrypted: encryptAES256GCM(
          randomBytes(32).toString('hex'),
          key,
        ),
      },
    });
    provider = await prisma.vpsProvider.findUniqueOrThrow({
      where: { id: providerId },
    });
  }
  const headers = Object.fromEntries(
    Object.entries(webhook.headers ?? {}).filter(
      ([name]) => name.toLowerCase() !== RELAY_TOKEN_HEADER.toLowerCase(),
    ),
  );
  return {
    ...webhook,
    enabled: webhook.enabled ?? true,
    url: `${relayBaseUrl(config)}/internal/webhook/evolution/${providerId}`,
    headers: {
      ...headers,
      [RELAY_TOKEN_HEADER]: decryptAES256GCM(
        provider.callbackTokenEncrypted!,
        key,
      ),
    },
  };
}

/** Preserve the public body, omitting only the Hub's private transport header. */
export function withoutRelayToken<T>(value: T): T {
  if (Array.isArray(value)) {
    const original: unknown[] = value;
    const items = original.map((item) => withoutRelayToken(item));
    return items.some((item, index) => item !== original[index])
      ? (items as T)
      : value;
  }
  if (!value || typeof value !== 'object') return value;
  let changed = false;
  const entries = Object.entries(value as Record<string, unknown>).flatMap(
    ([key, item]) => {
      if (key.toLowerCase() === RELAY_TOKEN_HEADER.toLowerCase()) {
        changed = true;
        return [];
      }
      const safe = withoutRelayToken(item);
      if (safe !== item) changed = true;
      return [[key, safe]];
    },
  );
  return changed ? (Object.fromEntries(entries) as T) : value;
}
