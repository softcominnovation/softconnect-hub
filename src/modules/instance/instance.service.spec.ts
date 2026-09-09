import {
  BadGatewayException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CacheService } from '../../cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdapterResolverService } from '../../providers/adapter-resolver.service';
import { InstanceResolverService } from '../../resolver/instance.resolver';
import { InstanceService } from './instance.service';

jest.mock('../../common/crypto.util', () => ({
  decryptAES256GCM: jest.fn().mockReturnValue('decrypted-api-key'),
}));

const PRODUCT = {
  productId: 'prod-1',
  apiKeyHash: 'hash',
  isActive: true,
  origins: [] as string[],
  hubRelay: true,
  adapterType: 'evolution',
  vpsProviderId: 'vp-1',
  batchWebhookEnabled: false,
  batchWebhookUrl: null as string | null,
};

const PROVIDER_ROW = {
  id: 'vp-1',
  providerUrl: 'https://evo.example.com',
  providerApiKey: 'iv:tag:cipher',
  adapterType: 'evolution',
  isActive: true,
};

const INSTANCE_ROW = {
  id: 'hub-inst-1',
  productId: 'prod-1',
  vpsProviderId: 'vp-1',
  instanceName: 'softcomshop_06220266000126',
  providerInstanceId: 'evo-id-1',
  vpsProvider: PROVIDER_ROW,
  product: { adapterType: 'evolution' },
};

describe('InstanceService — delete/create sync', () => {
  let service: InstanceService;
  let prisma: {
    vpsProvider: { findUnique: jest.Mock };
    instance: {
      findFirst: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
      deleteMany: jest.Mock;
    };
    productDefaultWebhook: { findUnique: jest.Mock };
    productDefaultProxy: { findUnique: jest.Mock };
  };
  let cache: { del: jest.Mock };
  let adapter: {
    fetchInstances: jest.Mock;
    createInstance: jest.Mock;
    deleteInstance: jest.Mock;
    applyInstanceDefaults?: jest.Mock;
  };
  let adapterResolver: { resolve: jest.Mock };

  beforeEach(async () => {
    prisma = {
      vpsProvider: { findUnique: jest.fn() },
      instance: {
        findFirst: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      productDefaultWebhook: { findUnique: jest.fn() },
      productDefaultProxy: { findUnique: jest.fn() },
    };
    cache = { del: jest.fn() };
    adapter = {
      fetchInstances: jest.fn(),
      createInstance: jest.fn(),
      deleteInstance: jest.fn(),
    };
    adapterResolver = { resolve: jest.fn().mockReturnValue(adapter) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstanceService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
        { provide: AdapterResolverService, useValue: adapterResolver },
        { provide: InstanceResolverService, useValue: {} },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue('a'.repeat(64)),
          },
        },
      ],
    }).compile();

    service = module.get(InstanceService);
  });

  describe('deleteInstance', () => {
    beforeEach(() => {
      prisma.instance.findFirst.mockResolvedValue(INSTANCE_ROW);
      prisma.instance.deleteMany.mockResolvedValue({ count: 1 });
    });

    it('deleta no provider e só então remove do Hub', async () => {
      adapter.deleteInstance.mockResolvedValue(undefined);

      await service.deleteInstance(PRODUCT, 'hub-inst-1');

      expect(adapter.deleteInstance).toHaveBeenCalledWith(
        expect.objectContaining({ providerUrl: PROVIDER_ROW.providerUrl }),
        INSTANCE_ROW.instanceName,
      );
      expect(prisma.instance.deleteMany).toHaveBeenCalledWith({
        where: { id: INSTANCE_ROW.id, productId: PRODUCT.productId },
      });
      expect(cache.del).toHaveBeenCalledWith(`instance:${INSTANCE_ROW.id}`);
    });

    it('NÃO remove do Hub se o provider falhar (falso positivo)', async () => {
      adapter.deleteInstance.mockRejectedValue(
        new HttpException({ message: 'Evolution timeout' }, 503),
      );

      await expect(
        service.deleteInstance(PRODUCT, 'hub-inst-1'),
      ).rejects.toBeInstanceOf(BadGatewayException);

      expect(prisma.instance.deleteMany).not.toHaveBeenCalled();
      expect(cache.del).not.toHaveBeenCalled();
    });

    it('remove órfão do Hub se o provider já não tiver a instância (404)', async () => {
      adapter.deleteInstance.mockRejectedValue(
        new NotFoundException('Instance does not exist'),
      );

      await service.deleteInstance(PRODUCT, 'hub-inst-1');

      expect(prisma.instance.deleteMany).toHaveBeenCalled();
    });

    it('404 se a instância não existir no Hub', async () => {
      prisma.instance.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteInstance(PRODUCT, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(adapter.deleteInstance).not.toHaveBeenCalled();
    });
  });

  describe('createInstance — órfão no provider', () => {
    beforeEach(() => {
      prisma.vpsProvider.findUnique.mockResolvedValue(PROVIDER_ROW);
      prisma.instance.findFirst.mockResolvedValue(null);
    });

    it('bloqueia create se o nome já existir só no provider', async () => {
      adapter.fetchInstances.mockResolvedValue([
        { instanceName: 'softcomshop_06220266000126' },
      ]);

      await expect(
        service.createInstance(PRODUCT, {
          instanceName: 'softcomshop_06220266000126',
          token: 'tok',
          qrcode: false,
          integration: 'WHATSAPP-BAILEYS',
        } as never),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(adapter.createInstance).not.toHaveBeenCalled();
    });

    it('cria normalmente quando Hub e provider estão livres', async () => {
      adapter.fetchInstances.mockResolvedValue([]);
      adapter.createInstance.mockResolvedValue({
        instanceName: 'nova',
        instanceId: 'evo-2',
      });
      prisma.instance.create.mockResolvedValue({
        id: 'hub-2',
        instanceName: 'nova',
      });
      prisma.productDefaultWebhook.findUnique.mockResolvedValue(null);
      prisma.productDefaultProxy.findUnique.mockResolvedValue(null);

      const result = await service.createInstance(PRODUCT, {
        instanceName: 'nova',
        token: 'tok',
        qrcode: false,
        integration: 'WHATSAPP-BAILEYS',
      } as never);

      expect(adapter.createInstance).toHaveBeenCalled();
      expect(result.hubId).toBe('hub-2');
    });
  });
});
