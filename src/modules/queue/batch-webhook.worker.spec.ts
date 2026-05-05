import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { BatchWebhookWorker } from './batch-webhook.worker';

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

const API_KEY_HASH = 'abc123def456hash';

describe('BatchWebhookWorker', () => {
  let worker: BatchWebhookWorker;

  const payload = {
    batchWebhookUrl: 'https://cliente.example.com/callback',
    apiKeyHash: API_KEY_HASH,
    batchJobId: 'batch-001',
    productId: 'prod-001',
    instanceId: 'inst-001',
    success: true,
    processedAt: '2026-04-29T12:00:00.000Z',
    deliveryError: null,
    messagePayload: { number: '5511999990001', text: 'Olá, João!' },
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        BatchWebhookWorker,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              if (key === 'REDIS_URL') return 'redis://localhost:6379';
              throw new Error(`Unknown config key: ${key}`);
            }),
          },
        },
      ],
    }).compile();

    worker = module.get(BatchWebhookWorker);
    worker.onModuleInit();
    jest.clearAllMocks();
    (axios.post as jest.Mock).mockResolvedValue({ status: 200 });
  });

  afterEach(async () => {
    await worker.onModuleDestroy();
  });

  function getProcessor() {
    const w = worker['worker'] as unknown as {
      __processorMap: Map<string, (job: unknown) => Promise<unknown>>;
    };
    return w.__processorMap.get('batch-webhook')!;
  }

  it('deve fazer POST para batchWebhookUrl com payload correto', async () => {
    await getProcessor()({ data: payload });

    expect(axios.post).toHaveBeenCalledWith(
      payload.batchWebhookUrl,
      expect.objectContaining({
        event: 'batch.message.result',
        batchJobId: payload.batchJobId,
        productId: payload.productId,
        instanceId: payload.instanceId,
        success: payload.success,
        processedAt: payload.processedAt,
        deliveryError: payload.deliveryError,
        payload: payload.messagePayload,
      }),
      expect.any(Object),
    );
  });

  it('deve assinar o corpo com apiKeyHash no header X-Hub-Signature', async () => {
    await getProcessor()({ data: payload });

    const call = (axios.post as jest.Mock).mock.calls[0];
    const sentBody = call[1] as Record<string, unknown>;
    const headers = (call[2] as { headers: Record<string, string> }).headers;

    const expectedSig = `sha256=${createHmac('sha256', API_KEY_HASH)
      .update(JSON.stringify(sentBody))
      .digest('hex')}`;

    expect(headers['X-Hub-Signature']).toBe(expectedSig);
  });

  it('deve incluir X-Hub-Event: batch.message.result no header', async () => {
    await getProcessor()({ data: payload });

    const headers = (
      (axios.post as jest.Mock).mock.calls[0][2] as {
        headers: Record<string, string>;
      }
    ).headers;

    expect(headers['X-Hub-Event']).toBe('batch.message.result');
  });

  it('deve lançar erro quando axios.post falha para que BullMQ realize retry', async () => {
    (axios.post as jest.Mock).mockRejectedValue(new Error('network error'));

    await expect(getProcessor()({ data: payload })).rejects.toThrow(
      'network error',
    );
  });

  it('deve registrar handler de erro no worker durante onModuleInit', () => {
    worker.onModuleInit();

    const w = worker['worker'] as unknown as { on: jest.Mock };
    expect(w.on).toHaveBeenCalledWith('error', expect.any(Function));
  });
});
