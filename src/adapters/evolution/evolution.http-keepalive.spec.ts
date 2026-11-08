import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import * as http from 'node:http';
import * as https from 'node:https';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AddressInfo, Socket } from 'node:net';
import { AppConfig } from '../../config/config.schema';
import { EvolutionHttpService } from './evolution.http';
import { QrRequestContext } from '../../common/qr-request-context';

// Public, disposable TLS identity, trusted only by this test's agent.
const cert = readFileSync(
  resolve(__dirname, '../../../test/fixtures/keepalive/localhost-cert.pem'),
);
const key = readFileSync(
  resolve(__dirname, '../../../test/fixtures/keepalive/localhost-key.pem'),
);

describe.each(['http', 'https'] as const)(
  '%s pooled Axios connections',
  (protocol) => {
    let server: http.Server;
    let agent: http.Agent;
    let client: AxiosInstance;
    let base: string;
    let connections: number;
    let warnings: Error[];
    const collectWarning = (warning: Error) => warnings.push(warning);

    beforeEach(async () => {
      warnings = [];
      connections = 0;
      process.on('warning', collectWarning);
      const handler: http.RequestListener = (req, res) => {
        req.resume();
        req.on('end', () => {
          const path = req.url ?? '/';
          if (path === '/hang') return;
          if (path === '/bad-gzip') {
            res.writeHead(200, { 'content-encoding': 'gzip' });
            res.end('invalid compressed body');
            return;
          }
          if (path === '/partial') {
            res.writeHead(200, { 'content-length': '1000' });
            res.write('{"incomplete":');
            setImmediate(() => res.destroy());
            return;
          }
          const hops = Number(path.split('/')[2]);
          if (path.startsWith('/redirect/') && hops > 0) {
            res.writeHead(307, { location: `/redirect/${hops - 1}` });
            res.end();
            return;
          }
          res.writeHead(path === '/failure' ? 422 : 201, {
            'content-type': 'application/json',
          });
          res.end(
            JSON.stringify({
              result: path === '/failure' ? 'rejected' : 'accepted',
            }),
          );
        });
      };
      server =
        protocol === 'https'
          ? https.createServer({ key, cert }, handler)
          : http.createServer(handler);
      server.on('connection', () => {
        connections++;
      });
      await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
      base = `${protocol}://127.0.0.1:${(server.address() as AddressInfo).port}`;
      agent =
        protocol === 'https'
          ? new https.Agent({ keepAlive: true, maxSockets: 2, ca: cert })
          : new http.Agent({ keepAlive: true, maxSockets: 2 });
      client = axios.create({
        httpAgent: agent,
        httpsAgent: agent,
        proxy: false,
        timeout: 2000,
      });
    });

    afterEach(async () => {
      agent.destroy();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      process.off('warning', collectWarning);
      jest.restoreAllMocks();
    });

    function checkPool() {
      const sockets = Object.values(agent.freeSockets)
        .flat()
        .filter((s): s is Socket => !!s);
      expect(sockets.length).toBeGreaterThan(0);
      for (const socket of sockets)
        expect(socket.listenerCount('error')).toBeLessThanOrEqual(2);
      expect(
        warnings.filter((w) => w.name === 'MaxListenersExceededWarning'),
      ).toEqual([]);
    }

    it('keeps listeners bounded across success, HTTP failure, concurrency and 12 redirects', async () => {
      for (let i = 0; i < 100; i++) {
        const response = await client.post(`${base}/ok`, { index: i });
        expect(response.status).toBe(201);
        expect(response.data).toEqual({ result: 'accepted' });
        checkPool();
      }
      expect(connections).toBe(1);
      for (let i = 0; i < 20; i++) {
        await expect(client.get(`${base}/failure`)).rejects.toMatchObject({
          response: { status: 422, data: { result: 'rejected' } },
        });
        await client.post(`${base}/redirect/12`, { fixture: true });
        await Promise.all(
          Array.from({ length: 6 }, () => client.get(`${base}/ok`)),
        );
        checkPool();
      }
      // Redirect hops may close their sockets; completed destinations remain reusable.
      const afterRedirects = connections;
      await Promise.all(
        Array.from({ length: 20 }, () => client.get(`${base}/ok`)),
      );
      expect(connections).toBe(afterRedirects);
      checkPool();
    });

    it('cleans up aborted and timed out calls and can reuse the pool afterward', async () => {
      for (let i = 0; i < 5; i++) {
        const controller = new AbortController();
        const pending = client.get(`${base}/hang`, {
          signal: controller.signal,
        });
        const timer = setTimeout(() => controller.abort(), 30);
        try {
          await expect(pending).rejects.toMatchObject({ code: 'ERR_CANCELED' });
        } finally {
          clearTimeout(timer);
        }
        await expect(
          client.get(`${base}/hang`, { timeout: 30 }),
        ).rejects.toMatchObject({ code: 'ECONNABORTED' });
        await client.get(`${base}/ok`);
        checkPool();
      }
    });

    it('preserves Hub response contracts and refuses incomplete HTTP 200 as success', async () => {
      const values = {
        PROXY_TIMEOUT_MS: 2000,
        PROXY_MAX_RETRIES: 0,
        CIRCUIT_BREAKER_THRESHOLD: 5,
        CIRCUIT_BREAKER_RESET_MS: 30000,
        SEND_PROVIDER_TIMEOUT_MS: 2000,
      };
      const service = new EvolutionHttpService({
        get: (name: keyof typeof values) => values[name],
      } as unknown as ConfigService<AppConfig, true>);
      // Inject only the local test transport; production methods/error handling are real.
      (service as unknown as { client: AxiosInstance }).client = client;
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      for (let i = 0; i < 30; i++) {
        await expect(
          service.request('get', base, 'fixture', '/ok'),
        ).resolves.toEqual({ result: 'accepted' });
      }
      await expect(
        service.requestSend(base, 'fixture', '/failure', {}),
      ).rejects.toMatchObject({
        status: 422,
        response: { result: 'rejected' },
      });
      await expect(
        service.requestSend(base, 'fixture', '/partial', {}),
      ).rejects.toMatchObject({ status: 502 });
      await expect(
        service.request('get', base, 'fixture', '/partial'),
      ).rejects.toMatchObject({ code: 'ERR_BAD_RESPONSE' });
      await expect(
        service.requestSend(base, 'fixture', '/bad-gzip', {}),
      ).rejects.toMatchObject({ status: 502 });
      await expect(
        service.tryOptionalRequest(
          { deadlineAt: performance.now() + 2000, callLimitMs: 2000 },
          'get',
          base,
          'fixture',
          '/partial',
        ),
      ).resolves.toEqual({ failure: 'transport_error' });
      const qr = new QrRequestContext(5000, 2000);
      qr.createOutcome = {
        result: 'not_sent',
        code: 'before_dispatch',
        observedAt: new Date().toISOString(),
        deadlineAt: new Date(Date.now() + 5000).toISOString(),
      };
      await expect(
        service.request('post', base, 'fixture', '/partial', {}, undefined, {
          execution: qr,
          operation: 'create',
        }),
      ).rejects.toMatchObject({ code: 'ERR_BAD_RESPONSE' });
      expect(qr.createOutcome).toMatchObject({
        result: 'unknown',
        code: 'transport_unknown',
      });
      expect(qr.createOutcome.status).toBeUndefined();
      await service.request('get', base, 'fixture', '/ok');
      checkPool();
    });
  },
);
