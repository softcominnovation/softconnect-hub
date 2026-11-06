import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import axios from 'axios';
import { MediaRequestContext } from '../../common/media-request-context';
import { MediaPreparationService } from './media-preparation.service';
import { MediaSourceClient } from './media-source.client';
import { MediaSourcePolicy } from './media-source-policy';
import { MediaTempStore } from './media-temp-store';

describe('Media source streaming HTTP (isolated loopback fixture)', () => {
  let server: Server;
  let origin: string;
  let root: string;
  let store: MediaTempStore;
  let service: MediaPreparationService;
  let policy: MediaSourcePolicy;
  let requests: Array<{ url: string; host?: string; auth?: string }>;
  let posted: Record<string, unknown> | undefined;
  let postedHeaders: Record<string, string | string[] | undefined>;
  const fileBytes = Buffer.alloc(200003, 71);
  const timers = new Set<NodeJS.Timeout>();
  beforeEach(async () => {
    requests = [];
    posted = undefined;
    postedHeaders = {};
    root = await mkdtemp(join(tmpdir(), 'mid02-source-'));
    const config = new ConfigService({
      MEDIA_TMP_DIR: root,
      MEDIA_MAX_SIZE_MB: 1,
    });
    store = new MediaTempStore(config);
    policy = new MediaSourcePolicy(config);
    server = createServer((req, res) => {
      requests.push({
        url: req.url ?? '',
        host: req.headers.host,
        auth: req.headers.authorization,
      });
      if (req.method === 'POST' && req.url === '/evolution') {
        postedHeaders = req.headers;
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          posted = JSON.parse(Buffer.concat(chunks).toString()) as Record<
            string,
            unknown
          >;
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ key: { id: 'fixture-message' } }));
        });
        return;
      }
      if (req.url === '/reset') {
        req.socket.destroy();
        return;
      } else if (req.url === '/bad-gzip') {
        res.writeHead(200, { 'Content-Encoding': 'gzip' });
        res.end('not gzip');
        return;
      } else if (req.url === '/html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
        res.end('<html><button>Download</button></html>');
        return;
      } else if (req.url === '/single-use') {
        if (requests.filter((r) => r.url === '/single-use').length > 1) {
          res.writeHead(403);
          res.end();
        } else {
          res.writeHead(200, { 'Content-Type': 'video/mp4' });
          res.end(fileBytes);
        }
        return;
      }
      if (req.url === '/redirect') {
        res.writeHead(302, { location: '/chunked' });
        res.end();
      } else if (req.url === '/private-redirect') {
        res.writeHead(302, { location: 'http://127.0.0.1/private' });
        res.end();
      } else if (req.url === '/loop') {
        res.writeHead(302, { location: '/loop' });
        res.end();
      } else if (req.url === '/compressed') {
        res.writeHead(200, { 'Content-Encoding': 'gzip' });
        res.end(gzipSync(Buffer.alloc(1000001)));
      } else if (req.url === '/chunked') {
        res.writeHead(200, { 'Content-Type': 'audio/ogg' });
        res.write('one');
        res.end('two');
      } else if (req.url === '/declared-too-large') {
        res.writeHead(200, { 'Content-Length': 50000001 });
        res.end('partial');
      } else if (req.url === '/slow') {
        res.writeHead(200);
        res.write('partial');
        const timer = setTimeout(() => {
          timers.delete(timer);
          res.end('late');
        }, 1000);
        timers.add(timer);
      } else if (req.url === '/drop') {
        res.writeHead(200);
        res.write('partial');
        const timer = setTimeout(() => {
          timers.delete(timer);
          res.destroy();
        }, 10);
        timers.add(timer);
      } else {
        res.writeHead(403);
        res.end('fixture denied');
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    origin = `http://files.fixture:${(server.address() as AddressInfo).port}`;
    // The policy itself is tested separately. Only the fixture allows a loopback socket.
    jest.spyOn(policy, 'resolve').mockImplementation((value) => {
      const url = new URL(value);
      if (url.hostname !== 'files.fixture')
        return Promise.reject(
          new BadRequestException('fixture blocked redirect'),
        );
      return Promise.resolve({ url, address: '127.0.0.1', family: 4 });
    });
    service = new MediaPreparationService(
      config,
      new MediaSourceClient(policy),
      store,
    );
  });
  afterEach(async () => {
    timers.forEach(clearTimeout);
    timers.clear();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await store.onModuleDestroy();
    await rm(root, { recursive: true, force: true });
    jest.restoreAllMocks();
  });
  const context = () => new MediaRequestContext(900000, 600000, 240000);

  it('records original source status and returns a clear error without leaking URL', async () => {
    const execution = context();
    await expect(
      service.prepare(
        { media: `${origin}/private-name?token=secret` },
        'media',
        execution,
      ),
    ).rejects.toMatchObject({
      status: 502,
      message:
        'Não foi possível baixar a mídia. O servidor do arquivo respondeu HTTP 403: acesso negado. O envio à Evolution não foi iniciado.',
    });
    expect(execution.diagnostics()).toMatchObject({
      sourceHost: 'files.fixture',
      sourceStage: 'response',
      sourceStatusCode: 403,
      sourceErrorCode: 'HTTP_STATUS',
      calls: 0,
    });
    expect(JSON.stringify(execution.diagnostics())).not.toMatch(
      /private-name|secret|token/,
    );
  });

  it('records DNS errors without their raw message', async () => {
    jest
      .spyOn(policy, 'resolve')
      .mockRejectedValueOnce(
        Object.assign(new Error('secret URL details'), { code: 'ENOTFOUND' }),
      );
    const execution = context();
    await expect(
      service.prepare({ media: `${origin}/file` }, 'media', execution),
    ).rejects.toMatchObject({
      status: 502,
      message:
        'Não foi possível resolver o endereço do servidor do arquivo (DNS). O envio à Evolution não foi iniciado.',
    });
    expect(execution.diagnostics()).toMatchObject({
      sourceStage: 'resolve',
      sourceErrorCode: 'ENOTFOUND',
    });
    expect(execution.mediaSource.statusCode).toBeUndefined();
    expect(JSON.stringify(execution.diagnostics())).not.toContain('secret');
  });

  it('records socket failures before a source response', async () => {
    const execution = context();
    await expect(
      service.prepare({ media: `${origin}/reset` }, 'media', execution),
    ).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining(
        'conexão com o servidor do arquivo foi interrompida',
      ) as unknown,
    });
    expect(execution.diagnostics()).toMatchObject({
      sourceStage: 'request',
      sourceErrorCode: 'ECONNRESET',
    });
    expect(execution.mediaSource.statusCode).toBeUndefined();
  });

  it('records decompression failure separately from HTTP status', async () => {
    const execution = context();
    await expect(
      service.prepare({ media: `${origin}/bad-gzip` }, 'media', execution),
    ).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('não pôde ser descompactado') as unknown,
    });
    expect(execution.diagnostics()).toMatchObject({
      sourceStage: 'decode',
      sourceStatusCode: 200,
      sourceErrorCode: 'Z_DATA_ERROR',
    });
  });

  it.each(['image', 'video', 'document'])(
    'rejects an HTML download page for %s with a clear error',
    async (mediatype) => {
      const execution = context();
      await expect(
        service.prepare(
          { media: `${origin}/html`, mediatype, fileName: 'arquivo.pdf' },
          'media',
          execution,
        ),
      ).rejects.toMatchObject({
        status: 502,
        message: expect.stringContaining(
          'página HTML em vez da mídia',
        ) as unknown,
      });
      expect(execution.diagnostics()).toMatchObject({
        sourceStatusCode: 200,
        sourceErrorCode: 'HTML_PAGE',
        calls: 0,
      });
      expect(
        (await readdir(root, { recursive: true })).filter((name) =>
          name.endsWith('.bin'),
        ),
      ).toEqual([]);
    },
  );

  it('allows explicitly requested HTML documents', async () => {
    const prepared = await service.prepare(
      {
        media: `${origin}/html`,
        mediatype: 'document',
        fileName: 'pagina.html',
      },
      'media',
      context(),
    );
    await prepared.dispose();
  });

  it.each(['CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID'])(
    'explains TLS failure %s without exposing native exception details',
    async (code) => {
      jest
        .spyOn(policy, 'resolve')
        .mockRejectedValueOnce(
          Object.assign(new Error('secret URL'), { code }),
        );
      const execution = context();
      await expect(
        service.prepare({ media: `${origin}/file` }, 'media', execution),
      ).rejects.toMatchObject({
        status: 502,
        message:
          'Falha ao estabelecer ou validar a conexão segura (TLS) com o servidor do arquivo. O envio à Evolution não foi iniciado.',
      });
      expect(execution.diagnostics()).toMatchObject({ sourceErrorCode: code });
    },
  );

  it.each(['media', 'sticker'] as const)(
    'sends the validated %s bytes over real HTTP as a JSON stream accepted by the synthetic provider',
    async (field) => {
      const execution = context();
      const payload = {
        [field]: `${origin}/single-use`,
        mediatype: 'video',
        fileName: 'ação.mp4',
        caption: 'Olá\n😀',
        extra: { keep: true },
      };
      const prepared = await service.prepare(payload, field, execution);
      const body = prepared.body(payload);
      try {
        const response = await axios.post(
          `http://127.0.0.1:${new URL(origin).port}/evolution`,
          body.stream,
          {
            headers: body.headers,
            maxRedirects: 0,
            maxBodyLength: Infinity,
            timeout: 2000,
            signal: execution.signal,
            proxy: false,
          },
        );
        expect(response.status).toBe(201);
        expect(response.data).toEqual({ key: { id: 'fixture-message' } });
        const received = Buffer.from(posted?.[field] as string, 'base64');
        expect(createHash('sha256').update(received).digest('hex')).toBe(
          createHash('sha256').update(fileBytes).digest('hex'),
        );
        expect(posted).toMatchObject({
          ...payload,
          [field]: fileBytes.toString('base64'),
        });
        expect(postedHeaders['content-type']).toBe('application/json');
        expect(postedHeaders['content-length']).toBe(
          String(body.contentLength),
        );
        expect(postedHeaders['transfer-encoding']).toBeUndefined();
        expect(requests.filter((r) => r.url === '/single-use')).toHaveLength(1);
      } finally {
        await prepared.dispose();
      }
    },
  );

  it('handles a source failure while the temporary file is still being opened', async () => {
    const original = store.create.bind(store);
    jest.spyOn(store, 'create').mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return original();
    });
    await expect(
      service.prepare({ media: `${origin}/drop` }, 'media', context()),
    ).rejects.toMatchObject({ status: 502 });
  });

  it('pins the socket address, preserves Host and streams chunked content through a checked redirect', async () => {
    const payload = { media: `${origin}/redirect`, mediatype: 'audio' };
    const prepared = await service.prepare(payload, 'media', context());
    expect(prepared.bytes).toBe(6);
    const chunks: Buffer[] = [];
    for await (const chunk of prepared.body(payload).stream)
      chunks.push(chunk as Buffer);
    const received = JSON.parse(Buffer.concat(chunks).toString()) as {
      media: string;
    };
    expect(Buffer.from(received.media, 'base64').toString()).toBe('onetwo');
    expect(policy.resolve).toHaveBeenCalledTimes(2);
    expect(requests.map((r) => r.url)).toEqual(['/redirect', '/chunked']);
    expect(
      requests.every(
        (r) => r.host === new URL(origin).host && r.auth === undefined,
      ),
    ).toBe(true);
    await prepared.dispose();
  });

  it.each(['/declared-too-large', '/compressed'])(
    'rejects oversized representation at %s and removes partials',
    async (path) => {
      await expect(
        service.prepare({ media: `${origin}${path}` }, 'media', context()),
      ).rejects.toMatchObject({ status: 413 });
      expect(
        (await readdir(root, { recursive: true })).filter((name) =>
          name.endsWith('.bin'),
        ),
      ).toEqual([]);
    },
  );

  it('does not connect to a blocked redirect or forward credentials', async () => {
    await expect(
      service.prepare(
        { media: `${origin}/private-redirect` },
        'media',
        context(),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(requests.map((r) => r.url)).toEqual(['/private-redirect']);
  });

  it('bounds redirect loops', async () => {
    await expect(
      service.prepare({ media: `${origin}/loop` }, 'media', context()),
    ).rejects.toMatchObject({ status: 502 });
    expect(requests).toHaveLength(6);
  });

  it.each(['/denied', '/drop'])(
    'cleans failed download %s without an Evolution POST',
    async (path) => {
      await expect(
        service.prepare({ media: `${origin}${path}` }, 'media', context()),
      ).rejects.toMatchObject({ status: 502 });
      expect(
        (await readdir(root, { recursive: true })).filter((name) =>
          name.endsWith('.bin'),
        ),
      ).toEqual([]);
    },
  );

  it('uses a preparation deadline even while the source sends data', async () => {
    const execution = new MediaRequestContext(900000, 600000, 40);
    await expect(
      service.prepare({ media: `${origin}/slow` }, 'media', execution),
    ).rejects.toMatchObject({ reason: 'download_timeout', status: 408 });
    expect(
      (await readdir(root, { recursive: true })).filter((name) =>
        name.endsWith('.bin'),
      ),
    ).toEqual([]);
  });

  it('interrupts a preparation download when the original consumer leaves', async () => {
    const execution = context();
    const result = service.prepare(
      { media: `${origin}/slow` },
      'media',
      execution,
    );
    const rejected = expect(result).rejects.toMatchObject({
      reason: 'client_disconnected',
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    execution.disconnect();
    await rejected;
    expect(
      (await readdir(root, { recursive: true })).filter((name) =>
        name.endsWith('.bin'),
      ),
    ).toEqual([]);
  });
});
