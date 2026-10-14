import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { Test, TestingModule } from '@nestjs/testing';
import { CacheService } from '../../cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdapterResolverService } from '../../providers/adapter-resolver.service';
import { InstanceResolverService } from '../../resolver/instance.resolver';
import { InstanceService } from './instance.service';
import {
  QrRequestContext,
  QrTimeoutException,
} from '../../common/qr-request-context';

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
            get: jest.fn().mockReturnValue(15000),
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

  describe('create QR — interruption and compensation', () => {
    const dto = { instanceName: 'fixture-qr', qrcode: true };
    let execution: QrRequestContext;

    beforeEach(() => {
      execution = new QrRequestContext(60000, 50000);
      prisma.vpsProvider.findUnique.mockResolvedValue(PROVIDER_ROW);
      prisma.instance.findFirst.mockResolvedValue(null);
      prisma.instance.create.mockResolvedValue({ id: 'hub-qr' });
      adapter.fetchInstances.mockResolvedValue([]);
      adapter.createInstance.mockResolvedValue({
        instanceId: 'remote-qr',
        instanceName: dto.instanceName,
      });
      adapter.applyInstanceDefaults = jest
        .fn()
        .mockResolvedValue({ webhook: { enabled: true } });
      prisma.productDefaultWebhook.findUnique.mockResolvedValue({
        enabled: true,
        url: 'https://fixture.invalid/webhook',
      });
      prisma.productDefaultProxy.findUnique.mockResolvedValue(null);
    });

    it.each([null, INSTANCE_ROW])(
      'never deletes or creates after a lookup timeout (existing=%p)',
      async (existing) => {
        prisma.instance.findFirst.mockResolvedValue(existing);
        adapter.fetchInstances.mockImplementation(() => {
          execution.abort('provider_timeout');
          return Promise.reject(new QrTimeoutException('provider_timeout'));
        });
        await expect(
          service.createInstance(PRODUCT, dto, execution),
        ).rejects.toMatchObject({ reason: 'provider_timeout' });
        expect(prisma.instance.delete).not.toHaveBeenCalled();
        expect(adapter.createInstance).not.toHaveBeenCalled();
        expect(adapter.deleteInstance).not.toHaveBeenCalled();
      },
    );

    it.each([408, 504])(
      'preserves real upstream %s in the lookup without a create',
      async (status) => {
        const error = new HttpException({ detail: 'upstream fixture' }, status);
        adapter.fetchInstances.mockRejectedValue(error);
        await expect(
          service.createInstance(PRODUCT, dto, execution),
        ).rejects.toBe(error);
        expect(adapter.createInstance).not.toHaveBeenCalled();
      },
    );

    it('does not repeat a creation whose remote result is unknown', async () => {
      adapter.createInstance.mockImplementation(() => {
        execution.abort('provider_timeout');
        return Promise.reject(new QrTimeoutException('provider_timeout'));
      });
      await expect(
        service.createInstance(PRODUCT, dto, execution),
      ).rejects.toBeInstanceOf(QrTimeoutException);
      expect(adapter.createInstance).toHaveBeenCalledTimes(1);
      expect(prisma.instance.create).not.toHaveBeenCalled();
      expect(adapter.deleteInstance).not.toHaveBeenCalled();
    });

    it('finishes local persistence after confirmed creation even if the caller disconnects', async () => {
      prisma.instance.create.mockImplementation(() => {
        execution.abort('client_disconnected');
        return Promise.resolve({ id: 'hub-qr' });
      });
      await expect(
        service.createInstance(PRODUCT, dto, execution),
      ).rejects.toMatchObject({ reason: 'client_disconnected' });
      expect(prisma.instance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerInstanceId: 'remote-qr',
          }) as unknown,
        }),
      );
      expect(execution.instanceId).toBe('hub-qr');
      expect(adapter.applyInstanceDefaults).not.toHaveBeenCalled();
      expect(prisma.instance.deleteMany).not.toHaveBeenCalled();
      expect(adapter.deleteInstance).not.toHaveBeenCalled();
    });

    it.each(['request_timeout', 'provider_timeout'] as const)(
      'preserves a known binding after %s in defaults without rollback',
      async (reason) => {
        adapter.applyInstanceDefaults!.mockImplementation(() => {
          execution.abort(reason);
          return Promise.reject(new QrTimeoutException(reason));
        });
        await expect(
          service.createInstance(PRODUCT, dto, execution),
        ).rejects.toBeInstanceOf(QrTimeoutException);
        expect(prisma.instance.create).toHaveBeenCalledTimes(1);
        expect(prisma.instance.deleteMany).not.toHaveBeenCalled();
        expect(adapter.deleteInstance).not.toHaveBeenCalled();
      },
    );

    it('compensates functional defaults failure before deleting the local binding', async () => {
      adapter.applyInstanceDefaults!.mockRejectedValue(
        new BadRequestException('fixture failure'),
      );
      adapter.deleteInstance.mockImplementation(() => {
        expect(prisma.instance.deleteMany).not.toHaveBeenCalled();
        return Promise.resolve();
      });
      await expect(
        service.createInstance(PRODUCT, dto, execution),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(adapter.deleteInstance).toHaveBeenCalledTimes(1);
      expect(prisma.instance.deleteMany).toHaveBeenCalledTimes(1);
    });

    it('keeps local evidence when compensation times out', async () => {
      adapter.applyInstanceDefaults!.mockRejectedValue(
        new BadRequestException('fixture failure'),
      );
      adapter.deleteInstance.mockImplementation(() => {
        execution.abort('provider_timeout');
        return Promise.reject(new QrTimeoutException('provider_timeout'));
      });
      await expect(
        service.createInstance(PRODUCT, dto, execution),
      ).rejects.toBeInstanceOf(QrTimeoutException);
      expect(adapter.deleteInstance).toHaveBeenCalledTimes(1);
      expect(prisma.instance.deleteMany).not.toHaveBeenCalled();
    });

    it('keeps the successful create body and uses one context for every step', async () => {
      await expect(
        service.createInstance(PRODUCT, dto, execution),
      ).resolves.toEqual({
        instanceId: 'remote-qr',
        instanceName: 'fixture-qr',
        hubId: 'hub-qr',
        webhook: { enabled: true },
      });
      expect(adapter.fetchInstances).toHaveBeenCalledWith(
        expect.objectContaining({ execution }),
      );
      expect(adapter.createInstance).toHaveBeenCalledWith(
        expect.objectContaining({ execution }),
        dto,
      );
      expect(adapter.applyInstanceDefaults).toHaveBeenCalledWith(
        expect.objectContaining({ execution }),
        dto.instanceName,
        expect.any(Object),
        expect.objectContaining({
          defaultProxyDeadlineAt: expect.any(Number) as unknown,
        }),
      );
      expect(prisma.instance.create).toHaveBeenCalledWith({
        data: expect.not.objectContaining({ execution }) as unknown,
      });
    });
  });

  describe('legacy create — preserve binding on timeout or uncertain rollback', () => {
    const dto = { instanceName: 'fixture-legacy', qrcode: false };

    beforeEach(() => {
      prisma.vpsProvider.findUnique.mockResolvedValue(PROVIDER_ROW);
      prisma.instance.findFirst.mockResolvedValue(null);
      adapter.fetchInstances.mockResolvedValue([]);
      adapter.createInstance.mockResolvedValue({
        instanceId: 'remote-created',
      });
      prisma.instance.create.mockResolvedValue({ id: 'hub-created' });
      prisma.productDefaultWebhook.findUnique.mockResolvedValue({
        enabled: true,
        url: 'https://fixture.invalid/webhook',
      });
      adapter.applyInstanceDefaults = jest.fn();
    });

    it.each(['ECONNABORTED', 'ETIMEDOUT'])(
      'preserves a confirmed create after local defaults timeout %s',
      async (code) => {
        adapter.applyInstanceDefaults!.mockRejectedValue(
          new AxiosError('timeout fixture', code),
        );
        await expect(
          service.createInstance(PRODUCT, dto),
        ).rejects.toMatchObject({
          status: 408,
          message: 'Request timeout',
        });
        expect(prisma.instance.create).toHaveBeenCalledTimes(1);
        expect(prisma.instance.deleteMany).not.toHaveBeenCalled();
        expect(adapter.deleteInstance).not.toHaveBeenCalled();
      },
    );

    it.each([408, 504])(
      'preserves upstream HTTP %s and the local binding',
      async (status) => {
        const error = new HttpException(
          { message: 'upstream timeout fixture' },
          status,
        );
        adapter.applyInstanceDefaults!.mockRejectedValue(error);
        await expect(service.createInstance(PRODUCT, dto)).rejects.toBe(error);
        expect(prisma.instance.deleteMany).not.toHaveBeenCalled();
        expect(adapter.deleteInstance).not.toHaveBeenCalled();
      },
    );

    it.each([false, true])(
      'removes the binding only after confirmed remote compensation (absent=%s)',
      async (absent) => {
        adapter.applyInstanceDefaults!.mockRejectedValue(
          new BadRequestException('invalid default fixture'),
        );
        adapter.deleteInstance.mockImplementation(() => {
          expect(prisma.instance.deleteMany).not.toHaveBeenCalled();
          return absent
            ? Promise.reject(new NotFoundException())
            : Promise.resolve();
        });
        await expect(
          service.createInstance(PRODUCT, dto),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(adapter.deleteInstance).toHaveBeenCalledTimes(1);
        expect(prisma.instance.deleteMany).toHaveBeenCalledWith({
          where: { id: 'hub-created' },
        });
      },
    );

    it.each([
      [new AxiosError('timeout fixture', 'ECONNABORTED'), 408],
      [new HttpException('upstream timeout fixture', 504), 504],
      [new Error('transport fixture'), 502],
    ] as const)(
      'keeps the binding after uncertain compensation: %s',
      async (error, status) => {
        adapter.applyInstanceDefaults!.mockRejectedValue(
          new BadRequestException('invalid default fixture'),
        );
        adapter.deleteInstance.mockRejectedValue(error);
        await expect(
          service.createInstance(PRODUCT, dto),
        ).rejects.toMatchObject({ status });
        expect(adapter.deleteInstance).toHaveBeenCalledTimes(1);
        expect(prisma.instance.deleteMany).not.toHaveBeenCalled();
      },
    );
  });

  describe('create — optional product proxy', () => {
    it.each([true, false])(
      'returns the original creation and logs an unconfirmed proxy without rollback (QR=%s)',
      async (qrcode) => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        try {
          prisma.vpsProvider.findUnique.mockResolvedValue(PROVIDER_ROW);
          prisma.instance.findFirst.mockResolvedValue(null);
          prisma.instance.create.mockResolvedValue({ id: 'hub-created' });
          adapter.fetchInstances.mockResolvedValue([]);
          const created = {
            instanceName: 'fixture',
            instanceId: 'remote-created',
            status: 'connecting',
            qrcode: { base64: 'qr-secret' },
          };
          adapter.createInstance.mockResolvedValue(created);
          prisma.productDefaultProxy.findUnique.mockResolvedValue({
            enabled: true,
            host: 'proxy-secret.invalid',
            password: 'proxy-secret',
          });
          adapter.applyInstanceDefaults = jest.fn().mockResolvedValue({
            proxyFailure: 'timeout',
          });
          const execution = qrcode
            ? new QrRequestContext(90000, 80000)
            : undefined;
          const result = await service.createInstance(
            PRODUCT,
            { instanceName: 'fixture', qrcode },
            execution,
          );
          expect(result).toEqual({ ...created, hubId: 'hub-created' });
          expect(result).not.toHaveProperty('proxyFailure');
          expect(adapter.deleteInstance).not.toHaveBeenCalled();
          expect(prisma.instance.deleteMany).not.toHaveBeenCalled();
          expect(warn).toHaveBeenCalledWith(
            JSON.stringify({
              event: 'instance_default_proxy_unconfirmed',
              productId: PRODUCT.productId,
              providerId: PROVIDER_ROW.id,
              instanceId: 'hub-created',
              reason: 'timeout',
            }),
          );
          expect(JSON.stringify(warn.mock.calls)).not.toMatch(
            /proxy-secret|qr-secret/,
          );
          expect(execution?.signal.aborted ?? false).toBe(false);
        } finally {
          warn.mockRestore();
        }
      },
    );
  });
});
