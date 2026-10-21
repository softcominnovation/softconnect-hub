import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { VpsProvider } from '@prisma/client';
import { EvolutionMaintenanceClient } from './evolution.maintenance';
import { encryptAES256GCM } from '../../common/crypto.util';

describe('Evolution maintenance HTTP', () => {
  let server: Server;
  let provider: VpsProvider;
  let requests: Array<{ method: string | undefined; url: string | undefined }>;
  let status = 200;
  let body: unknown;
  let delay = 0;
  const key = 'a'.repeat(64);
  const client = new EvolutionMaintenanceClient(
    new ConfigService({
      ENCRYPTION_KEY: key,
      MAINTENANCE_HTTP_TIMEOUT_MS: 100,
    }),
  );
  beforeAll(async () => {
    server = createServer((req, res) => {
      requests.push({ method: req.method, url: req.url });
      setTimeout(() => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      }, delay);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    provider = {
      providerUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      providerApiKey: encryptAES256GCM('test-key', key),
    } as VpsProvider;
  });
  beforeEach(() => {
    requests = [];
    status = 200;
    delay = 0;
    body = { status: 'SUCCESS', error: false };
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  it('uses DELETE and encodes the instance path once', async () => {
    await client.act(
      provider,
      'instance/a',
      'disconnect',
      new AbortController().signal,
      Date.now() + 1000,
    );
    expect(requests).toEqual([
      { method: 'DELETE', url: '/instance/logout/instance%2Fa' },
    ]);
  });
  it('does not retry a refused deletion or expose the upstream body', async () => {
    status = 403;
    body = { secret: 'do not leak' };
    await expect(
      client.act(
        provider,
        'test',
        'delete',
        new AbortController().signal,
        Date.now() + 1000,
      ),
    ).rejects.toThrow('upstream_403');
    expect(requests).toHaveLength(1);
  });
  it('never interprets a timeout as failed deletion and does not retry', async () => {
    delay = 180;
    await expect(
      client.act(
        provider,
        'test',
        'delete',
        new AbortController().signal,
        Date.now() + 1000,
      ),
    ).rejects.toThrow('transport_unconfirmed');
    expect(requests).toHaveLength(1);
  });
  it('validates live identity and state', async () => {
    body = { instance: { instanceName: 'different', state: 'close' } };
    await expect(
      client.state(
        provider,
        'test',
        new AbortController().signal,
        Date.now() + 1000,
      ),
    ).rejects.toThrow('state_invalid');
  });
  it('rejects a generic successful envelope as inventory', async () => {
    await expect(
      client.inventory(
        provider,
        new AbortController().signal,
        Date.now() + 1000,
      ),
    ).rejects.toThrow('inventory_invalid');
  });
  it('does not dispatch after cancellation', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      client.act(provider, 'test', 'delete', abort.signal, Date.now() + 1000),
    ).rejects.toThrow('deadline');
    expect(requests).toHaveLength(0);
  });
});
