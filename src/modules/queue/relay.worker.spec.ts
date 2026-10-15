import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RelayWorker } from './relay.worker';
import { RelayIngressService } from './relay-ingress.service';
import { RELAY_QUEUE_NAME } from './queue.constants';

jest.mock('bullmq', () => {
  const processorMap = new Map<string, (job: unknown) => Promise<unknown>>();
  const WorkerMock = jest
    .fn()
    .mockImplementation(
      (name: string, processor: (job: unknown) => Promise<unknown>) => {
        processorMap.set(name, processor);
        return {
          on: jest.fn(),
          close: jest.fn(),
          __processorMap: processorMap,
        };
      },
    );
  return { Worker: WorkerMock };
});

jest.mock('axios', () => ({
  default: { post: jest.fn() },
  post: jest.fn(),
}));

import axios from 'axios';

describe('RelayWorker', () => {
  let relayWorker: RelayWorker;
  const ingress = {
    validateJob: jest.fn(),
    markEvent: jest.fn(),
    retainLegacyJob: jest.fn(),
  };
  let prisma: {
    webhookConfig: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      webhookConfig: { findFirst: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [
        RelayWorker,
        { provide: RelayIngressService, useValue: ingress },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379'),
            get: jest.fn().mockReturnValue(undefined),
          },
        },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    relayWorker = module.get(RelayWorker);
    relayWorker.onModuleInit();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await relayWorker.onModuleDestroy();
  });

  function getProcessor(name = RELAY_QUEUE_NAME) {
    const worker = relayWorker['worker'] as unknown as {
      __processorMap: Map<string, (job: unknown) => Promise<unknown>>;
    };
    return worker.__processorMap.get(name)!;
  }

  it('deve encaminhar o payload com assinatura HMAC-SHA256 correta', async () => {
    const secret = 'webhook-secret';
    const body = { event: 'messages.upsert', instance: 'my-instance' };

    ingress.validateJob.mockResolvedValue({
      productId: 'prod-1',
      product: { hubRelay: true, isActive: true },
    });
    prisma.webhookConfig.findFirst.mockResolvedValue({
      url: 'https://produto.example.com/webhook',
      secret,
      isActive: true,
      events: ['MESSAGES_UPSERT'],
    });
    (axios.post as jest.Mock).mockResolvedValue({ status: 200 });

    await getProcessor()({
      data: {
        version: 2,
        adapterType: 'evolution',
        instanceName: 'my-instance',
        body,
      },
    });

    const expectedSig = `sha256=${createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex')}`;
    expect(axios.post).toHaveBeenCalledWith(
      'https://produto.example.com/webhook',
      body,
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Hub-Signature': expectedSig,
        }) as unknown,
      }),
    );
  });

  it('deve encerrar silenciosamente quando a instância não for encontrada', async () => {
    ingress.validateJob.mockResolvedValue(null);

    await expect(
      getProcessor()({
        data: {
          version: 2,
          adapterType: 'evolution',
          instanceName: 'unknown',
          body: {},
        },
      }),
    ).resolves.toBeUndefined();

    expect(axios.post).not.toHaveBeenCalled();
  });

  it('deve encerrar silenciosamente quando não houver WebhookConfig ativa', async () => {
    ingress.validateJob.mockResolvedValue({
      productId: 'prod-1',
      product: { hubRelay: true, isActive: true },
    });
    prisma.webhookConfig.findFirst.mockResolvedValue(null);

    await expect(
      getProcessor()({
        data: {
          version: 2,
          adapterType: 'evolution',
          instanceName: 'my-instance',
          body: {},
        },
      }),
    ).resolves.toBeUndefined();

    expect(axios.post).not.toHaveBeenCalled();
  });

  it('retém jobs antigos sem inventar a origem pelo nome', async () => {
    await getProcessor('relay')({
      id: 'legacy-fixture',
      data: { adapterType: 'evolution', instanceName: 'same', body: {} },
    });
    expect(ingress.retainLegacyJob).toHaveBeenCalledWith(
      expect.objectContaining({ instanceName: 'same' }),
      'legacy-fixture',
    );
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('separa a fila nova da fila que réplicas antigas ainda consomem', () => {
    expect(RELAY_QUEUE_NAME).not.toBe('relay');
    expect(getProcessor()).not.toBe(getProcessor('relay'));
  });

  it('não entrega eventos fora da seleção do produto', async () => {
    ingress.validateJob.mockResolvedValue({
      productId: 'prod-1',
      product: { hubRelay: true, isActive: true },
    });
    prisma.webhookConfig.findFirst.mockResolvedValue({
      url: 'https://fixture.invalid',
      secret: 'fixture',
      events: ['CONNECTION_UPDATE'],
    });
    await getProcessor()({
      data: {
        version: 2,
        instanceName: 'fixture',
        body: { event: 'messages.upsert' },
      },
    });
    expect(axios.post).not.toHaveBeenCalled();
    expect(ingress.markEvent).toHaveBeenCalledWith(
      undefined,
      'delivered',
      'event_filtered',
    );
  });
});
