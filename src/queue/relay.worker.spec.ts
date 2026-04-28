import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RelayWorker } from './relay.worker';

jest.mock('bullmq', () => {
  const processorMap = new Map<string, (job: unknown) => Promise<unknown>>();
  const WorkerMock = jest
    .fn()
    .mockImplementation(
      (name: string, processor: (job: unknown) => Promise<unknown>) => {
        processorMap.set(name, processor);
        return { on: jest.fn(), close: jest.fn(), __processorMap: processorMap };
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
  let prisma: {
    instance: { findFirst: jest.Mock };
    webhookConfig: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      instance: { findFirst: jest.fn() },
      webhookConfig: { findFirst: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [
        RelayWorker,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379'),
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

  function getProcessor() {
    const worker = relayWorker['worker'] as unknown as {
      __processorMap: Map<string, (job: unknown) => Promise<unknown>>;
    };
    return worker.__processorMap.get('relay')!;
  }

  it('deve encaminhar o payload com assinatura HMAC-SHA256 correta', async () => {
    const secret = 'webhook-secret';
    const body = { event: 'messages.upsert', instance: 'my-instance' };

    prisma.instance.findFirst.mockResolvedValue({ productId: 'prod-1' });
    prisma.webhookConfig.findFirst.mockResolvedValue({
      url: 'https://produto.example.com/webhook',
      secret,
      isActive: true,
    });
    (axios.post as jest.Mock).mockResolvedValue({ status: 200 });

    await getProcessor()({
      data: { adapterType: 'evolution', instanceName: 'my-instance', body },
    });

    const expectedSig =
      `sha256=${createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex')}`;
    expect(axios.post).toHaveBeenCalledWith(
      'https://produto.example.com/webhook',
      body,
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Hub-Signature': expectedSig,
        }),
      }),
    );
  });

  it('deve encerrar silenciosamente quando a instância não for encontrada', async () => {
    prisma.instance.findFirst.mockResolvedValue(null);

    await expect(
      getProcessor()({
        data: { adapterType: 'evolution', instanceName: 'unknown', body: {} },
      }),
    ).resolves.toBeUndefined();

    expect(axios.post).not.toHaveBeenCalled();
  });

  it('deve encerrar silenciosamente quando não houver WebhookConfig ativa', async () => {
    prisma.instance.findFirst.mockResolvedValue({ productId: 'prod-1' });
    prisma.webhookConfig.findFirst.mockResolvedValue(null);

    await expect(
      getProcessor()({
        data: { adapterType: 'evolution', instanceName: 'my-instance', body: {} },
      }),
    ).resolves.toBeUndefined();

    expect(axios.post).not.toHaveBeenCalled();
  });
});
