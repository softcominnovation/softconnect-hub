import {
  BadGatewayException,
  Logger,
  RequestTimeoutException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../../cache/cache.service';
import { encryptAES256GCM } from '../../../common/crypto.util';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdapterResolverService } from '../../../providers/adapter-resolver.service';
import type {
  ProviderContext,
  SetWebhookDto,
} from '../../../providers/whatsapp-provider.interface';
import { RELAY_TOKEN_HEADER } from '../../webhook/relay-configuration';
import { ProductsService } from './products.service';

const key = 'a'.repeat(64);
const hubUrl = 'https://hub.invalid/api/v1';
const directUrl = 'https://client.invalid/webhook';
const provider = {
  id: 'provider-a',
  adapterType: 'evolution',
  providerUrl: 'https://evolution.invalid',
  providerApiKey: encryptAES256GCM('provider-key', key),
  callbackTokenEncrypted: encryptAES256GCM('relay-token', key),
};
const instance = {
  id: 'instance-a',
  productId: 'product-a',
  instanceName: 'arbitrary-name',
  vpsProviderId: provider.id,
  vpsProvider: provider,
};
const events = ['CONNECTION_UPDATE'];
const headers = Object.freeze({ 'X-Client': 'client-value' });
const previous = Object.freeze({ byEvents: true, base64: false, headers });

describe.each([false, true])(
  'ProductsService.syncRelay hubRelay=%s',
  (hubRelay) => {
    let service: ProductsService;
    const adapter = {
      findWebhook: jest.fn<Promise<unknown>, [ProviderContext, string]>(),
      setWebhook: jest.fn<
        Promise<unknown>,
        [ProviderContext, string, SetWebhookDto]
      >(),
    };
    const prisma = {
      product: { findUnique: jest.fn() },
      instance: { findMany: jest.fn() },
      webhookConfig: { findFirst: jest.fn() },
      vpsProvider: { findUniqueOrThrow: jest.fn(), updateMany: jest.fn() },
    };
    const summaryUrl = hubRelay
      ? `${hubUrl}/internal/webhook/evolution`
      : directUrl;

    beforeEach(() => {
      jest.resetAllMocks();
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      prisma.product.findUnique.mockResolvedValue({
        hubRelay,
        adapterType: 'evolution',
      });
      prisma.instance.findMany.mockResolvedValue([instance]);
      prisma.webhookConfig.findFirst.mockResolvedValue({
        url: directUrl,
        events,
      });
      prisma.vpsProvider.findUniqueOrThrow.mockResolvedValue(provider);
      adapter.setWebhook.mockResolvedValue({});
      service = new ProductsService(
        prisma as unknown as PrismaService,
        {} as CacheService,
        new ConfigService({ ENCRYPTION_KEY: key, HUB_BASE_URL: hubUrl }),
        { resolve: () => adapter } as unknown as AdapterResolverService,
      );
    });

    afterEach(() => jest.restoreAllMocks());

    function expectConfigured(
      byEvents: boolean,
      base64: boolean,
      custom = false,
    ) {
      expect(adapter.setWebhook).toHaveBeenCalledTimes(1);
      expect(adapter.setWebhook).toHaveBeenCalledWith(
        { providerUrl: provider.providerUrl, providerApiKey: 'provider-key' },
        instance.instanceName,
        {
          webhook: {
            enabled: true,
            url: hubRelay
              ? `${hubUrl}/internal/webhook/evolution/${provider.id}`
              : directUrl,
            events,
            byEvents,
            base64,
            headers: hubRelay
              ? {
                  ...(custom ? headers : {}),
                  [RELAY_TOKEN_HEADER]: 'relay-token',
                }
              : custom
                ? headers
                : undefined,
          },
        },
      );
      expect(prisma.vpsProvider.updateMany).not.toHaveBeenCalled();
      if (!hubRelay)
        expect(prisma.vpsProvider.findUniqueOrThrow).not.toHaveBeenCalled();
    }

    it.each([null, undefined, {}, { webhook: null }])(
      'configures an absent webhook (%p) with the existing defaults and response',
      async (response) => {
        adapter.findWebhook.mockResolvedValue(response);
        expect(await service.syncRelay(instance.productId)).toEqual({
          total: 1,
          synced: 1,
          failed: 0,
          targetUrl: summaryUrl,
        });
        expectConfigured(false, true);
        expect(prisma.instance.findMany).toHaveBeenCalledWith({
          where: { productId: instance.productId, isActive: true },
          include: { vpsProvider: true },
        });
      },
    );

    it.each([
      { name: 'flat', response: previous, byEvents: true },
      {
        name: 'wrapped',
        response: Object.freeze({ webhook: previous }),
        byEvents: true,
      },
      {
        name: 'legacy aliases',
        response: Object.freeze({
          webhookByEvents: true,
          webhookBase64: false,
          headers,
        }),
        byEvents: true,
      },
      {
        name: 'explicit false before aliases',
        response: Object.freeze({
          byEvents: false,
          webhookByEvents: true,
          base64: false,
          webhookBase64: true,
          headers,
        }),
        byEvents: false,
      },
    ])(
      'preserves options and headers: $name',
      async ({ response, byEvents }) => {
        adapter.findWebhook.mockResolvedValue(response);
        const result = await service.syncRelay(instance.productId);
        expect(result).toEqual({
          total: 1,
          synced: 1,
          failed: 0,
          targetUrl: summaryUrl,
        });
        expect(JSON.stringify(result)).not.toContain('relay-token');
        expectConfigured(byEvents, false, true);
      },
    );

    it.each([
      new RequestTimeoutException('lookup timeout'),
      new BadGatewayException('lookup failed'),
    ])(
      'does not treat lookup failure as an absent configuration: %s',
      async (error) => {
        adapter.findWebhook.mockRejectedValue(error);
        expect(await service.syncRelay(instance.productId)).toEqual({
          total: 1,
          synced: 0,
          failed: 1,
          targetUrl: summaryUrl,
          errors: [
            {
              instanceName: instance.instanceName,
              error: JSON.stringify(error.getResponse()),
            },
          ],
        });
        expect(adapter.setWebhook).not.toHaveBeenCalled();
        expect(prisma.vpsProvider.findUniqueOrThrow).not.toHaveBeenCalled();
      },
    );

    it('reports a failed set instead of counting it as synchronized', async () => {
      adapter.findWebhook.mockResolvedValue(null);
      adapter.setWebhook.mockRejectedValue(new Error('set failed'));
      expect(await service.syncRelay(instance.productId)).toEqual({
        total: 1,
        synced: 0,
        failed: 1,
        targetUrl: summaryUrl,
        errors: [{ instanceName: instance.instanceName, error: 'set failed' }],
      });
      expectConfigured(false, true);
    });

    it('continues with other instances after a lookup failure', async () => {
      const second = {
        ...instance,
        id: 'instance-b',
        instanceName: 'another-name',
      };
      prisma.instance.findMany.mockResolvedValue([instance, second]);
      adapter.findWebhook
        .mockRejectedValueOnce(new Error('lookup failed'))
        .mockResolvedValueOnce(null);
      expect(await service.syncRelay(instance.productId)).toEqual({
        total: 2,
        synced: 1,
        failed: 1,
        targetUrl: summaryUrl,
        errors: [
          { instanceName: instance.instanceName, error: 'lookup failed' },
        ],
      });
      expect(adapter.setWebhook).toHaveBeenCalledTimes(1);
      expect(adapter.setWebhook.mock.calls[0][1]).toBe(second.instanceName);
    });
  },
);
