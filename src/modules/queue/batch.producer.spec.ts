import { Test } from '@nestjs/testing';
import { CacheService } from '../../cache/cache.service';
import type { SendTextDto } from '../../providers/whatsapp-provider.interface';
import { BatchProducer } from './batch.producer';
import { BATCH_QUEUE } from './queue.constants';

type FakeJob = {
  name: string;
  data: {
    batchJobId: string;
    productId: string;
    apiKeyHash: string;
    instanceId: string;
    adapterType: string;
    instanceName: string;
    providerUrl: string;
    providerApiKey: string;
    message: SendTextDto;
    batchWebhookEnabled: boolean;
    batchWebhookUrl: string | null;
  };
  opts: { delay?: number; attempts: number };
};

describe('BatchProducer', () => {
  let producer: BatchProducer;
  let addBulkMock: jest.Mock<Promise<unknown[]>, [FakeJob[]]>;
  let setWithTTLMock: jest.Mock;

  const batchJobId = 'batch-001';
  const productId = 'prod-001';
  const apiKeyHash = 'hash-abc123';
  const instanceId = 'inst-001';
  const adapterType = 'evolution';
  const instanceName = 'my-instance';
  const providerUrl = 'http://evolution.local:8080';
  const providerApiKey = 'secret-key';

  const messages: SendTextDto[] = [
    { number: '5511999990001', text: 'Olá 1' },
    { number: '5511999990002', text: 'Olá 2' },
    { number: '5511999990003', text: 'Olá 3' },
  ];

  async function addAll(delayMs?: number): Promise<void> {
    await producer.addJobs(
      batchJobId,
      productId,
      apiKeyHash,
      instanceId,
      adapterType,
      instanceName,
      providerUrl,
      providerApiKey,
      messages,
      delayMs,
    );
  }

  function getCapturedJobs(): FakeJob[] {
    return addBulkMock.mock.calls[0][0];
  }

  beforeEach(async () => {
    addBulkMock = jest
      .fn<Promise<unknown[]>, [FakeJob[]]>()
      .mockResolvedValue([]);
    setWithTTLMock = jest.fn().mockResolvedValue(undefined);

    const module = await Test.createTestingModule({
      providers: [
        BatchProducer,
        {
          provide: BATCH_QUEUE,
          useValue: { addBulk: addBulkMock, close: jest.fn() },
        },
        { provide: CacheService, useValue: { setWithTTL: setWithTTLMock } },
      ],
    }).compile();

    producer = module.get(BatchProducer);
  });

  it('deve armazenar o total de mensagens no Redis antes de enfileirar', async () => {
    await addAll();

    expect(setWithTTLMock).toHaveBeenCalledWith(
      `batch:total:${batchJobId}`,
      3,
      86400,
    );
  });

  it('deve publicar um job por mensagem com batchJobId no payload', async () => {
    await addAll();

    expect(addBulkMock).toHaveBeenCalledTimes(1);
    const jobs = getCapturedJobs();
    expect(jobs).toHaveLength(3);
    jobs.forEach((job, i) => {
      expect(job.data.batchJobId).toBe(batchJobId);
      expect(job.data.message).toEqual(messages[i]);
    });
  });

  it('deve propagar apiKeyHash e instanceId em cada job', async () => {
    await addAll();

    const jobs = getCapturedJobs();
    jobs.forEach((job) => {
      expect(job.data.apiKeyHash).toBe(apiKeyHash);
      expect(job.data.instanceId).toBe(instanceId);
    });
  });

  it('deve aplicar delay incremental quando delayMs for informado', async () => {
    await addAll(500);

    const jobs = getCapturedJobs();
    expect(jobs[0].opts.delay).toBe(0);
    expect(jobs[1].opts.delay).toBe(500);
    expect(jobs[2].opts.delay).toBe(1000);
  });

  it('deve configurar attempts: 1 em todos os jobs', async () => {
    await addAll();

    const jobs = getCapturedJobs();
    jobs.forEach((job) => expect(job.opts.attempts).toBe(1));
  });

  it('deve incluir batchWebhookEnabled e batchWebhookUrl no payload de cada job', async () => {
    await producer.addJobs(
      batchJobId,
      productId,
      apiKeyHash,
      instanceId,
      adapterType,
      instanceName,
      providerUrl,
      providerApiKey,
      messages,
      undefined,
      true,
      'https://cliente.example.com/callback',
    );

    const jobs = getCapturedJobs();
    jobs.forEach((job) => {
      expect(job.data.batchWebhookEnabled).toBe(true);
      expect(job.data.batchWebhookUrl).toBe(
        'https://cliente.example.com/callback',
      );
    });
  });

  it('deve usar batchWebhookEnabled=false e batchWebhookUrl=null por padrão', async () => {
    await addAll();

    const jobs = getCapturedJobs();
    jobs.forEach((job) => {
      expect(job.data.batchWebhookEnabled).toBe(false);
      expect(job.data.batchWebhookUrl).toBeNull();
    });
  });
});
