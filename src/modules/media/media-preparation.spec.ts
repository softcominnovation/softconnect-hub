import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { MediaRequestContext } from '../../common/media-request-context';
import { inspectBase64 } from './media-base64';
import {
  MediaPreparationService,
  evolutionMediaDefaults,
} from './media-preparation.service';
import { MediaSourceClient } from './media-source.client';
import { MediaSourcePolicy } from './media-source-policy';
import { MediaTempStore } from './media-temp-store';

const execution = () => new MediaRequestContext(900000, 600000, 240000);
const hash = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');

describe('Media preparation and streaming JSON', () => {
  let root: string;
  let store: MediaTempStore;
  let sources: MediaSourceClient;
  let service: MediaPreparationService;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mid02-preparation-'));
    const config = new ConfigService({ MEDIA_TMP_DIR: root });
    store = new MediaTempStore(config);
    sources = new MediaSourceClient(new MediaSourcePolicy(config));
    service = new MediaPreparationService(config, sources, store);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await store.onModuleDestroy();
    await rm(root, { recursive: true, force: true });
  });

  async function binaries(): Promise<string[]> {
    return (await readdir(root, { recursive: true })).filter((name) =>
      name.endsWith('.bin'),
    );
  }

  it.each([1, 2, 3, 65535, 65536, 65537, 150003])(
    'preserves %s bytes, Unicode and extra fields without corrupting base64 alignment',
    async (length) => {
      const bytes = Buffer.alloc(length, 123);
      const dto = {
        media: `data:video/mp4;base64,${bytes.toString('base64')}`,
        mediatype: 'video',
        fileName: 'Vídeo "ação".mp4',
        caption: 'Olá\n𐐀 😀',
        quoted: { id: 'q' },
        extra: ['campo', 4],
      };
      const prepared = await service.prepare(dto, 'media', execution());
      const body = prepared.body(dto);
      const chunks: Buffer[] = [];
      for await (const chunk of body.stream) chunks.push(chunk as Buffer);
      const json = Buffer.concat(chunks);
      expect(json.length).toBe(body.contentLength);
      const received = JSON.parse(json.toString()) as Record<string, unknown>;
      expect(hash(Buffer.from(received.media as string, 'base64'))).toBe(
        hash(bytes),
      );
      expect(received).toMatchObject({
        ...dto,
        media: bytes.toString('base64'),
        mimetype: 'video/mp4',
      });
      await prepared.dispose();
      expect(await binaries()).toEqual([]);
    },
  );

  it.each([
    '@@@',
    'a',
    'abcde',
    'TQ=',
    'TQ===',
    'TQ==AAAA',
    'TR==',
    'TWF=',
    'data:video/mp4,AAAA',
    'data:;base64,',
    '',
  ])('rejects invalid base64 before dispatch: %s', async (value) => {
    await expect(
      service.prepare({ media: value }, 'media', execution()),
    ).rejects.toMatchObject({ status: 400 });
    expect(await binaries()).toEqual([]);
  });

  it.each([
    'TQ==',
    'TQ',
    ' T Q = =\n',
    'TWE=',
    'TWE',
    'TWFu',
    'data:;base64,TQ==',
  ])('accepts supported padding/data URI: %s', async (value) => {
    const prepared = await service.prepare(
      { sticker: value },
      'sticker',
      execution(),
    );
    expect(prepared.bytes).toBeGreaterThan(0);
    await prepared.dispose();
  });

  it.each([49999999, 50000000, 50000001])(
    'enforces the decimal limit with a streamed %s-byte source',
    async (size) => {
      const baseline = process.memoryUsage();
      const peak = {
        rss: baseline.rss,
        heapUsed: baseline.heapUsed,
        external: baseline.external,
      };
      const sample = () => {
        const now = process.memoryUsage();
        peak.rss = Math.max(peak.rss, now.rss);
        peak.heapUsed = Math.max(peak.heapUsed, now.heapUsed);
        peak.external = Math.max(peak.external, now.external);
      };
      const block = Buffer.alloc(65536, 7);
      const open = jest.spyOn(sources, 'open').mockResolvedValue({
        stream: Readable.from(
          (function* () {
            for (let left = size; left > 0; left -= block.length) {
              sample();
              yield block.subarray(0, Math.min(left, block.length));
            }
          })(),
          { objectMode: false },
        ),
        contentType: 'video/mp4',
      });
      const result = service.prepare(
        { media: 'https://fixture.invalid/one-use.mp4', mediatype: 'video' },
        'media',
        execution(),
      );
      if (size > 50000000)
        await expect(result).rejects.toMatchObject({ status: 413 });
      else {
        const prepared = await result;
        expect(prepared.bytes).toBe(size);
        const body = prepared.body({ mediatype: 'video' });
        let sent = 0;
        let maximumChunk = 0;
        for await (const chunk of body.stream) {
          sample();
          sent += (chunk as Buffer).length;
          maximumChunk = Math.max(maximumChunk, (chunk as Buffer).length);
        }
        expect(sent).toBe(body.contentLength);
        expect(maximumChunk).toBeLessThan(256 * 1024);
        await prepared.dispose();
      }
      expect(open).toHaveBeenCalledTimes(1);
      expect(await binaries()).toEqual([]);
      if (process.env.MEDIA_RESOURCE_PROBE === 'true')
        console.info(
          JSON.stringify({
            event: 'mid02_synthetic_resource_probe',
            fileBytes: size,
            rssStart: baseline.rss,
            rssPeakSampled: peak.rss,
            heapDelta: peak.heapUsed - baseline.heapUsed,
            externalDelta: peak.external - baseline.external,
          }),
        );
    },
  );

  it('uses a changed size setting for base64 and remote content', async () => {
    const small = new MediaPreparationService(
      new ConfigService({ MEDIA_MAX_SIZE_MB: 1 }),
      sources,
      store,
    );
    await expect(
      small.prepare(
        { media: Buffer.alloc(1000001).toString('base64') },
        'media',
        execution(),
      ),
    ).rejects.toMatchObject({ status: 413 });
    jest.spyOn(sources, 'open').mockResolvedValue({
      stream: Readable.from([Buffer.alloc(1000001)]),
      contentLength: 1,
    });
    await expect(
      small.prepare(
        { media: 'https://fixture.invalid/media' },
        'media',
        execution(),
      ),
    ).rejects.toMatchObject({ status: 413 });
    expect(await binaries()).toEqual([]);
  });

  it('does not download a URL again and uses only the prepared content', async () => {
    const original = Buffer.from('first and only content');
    const open = jest.spyOn(sources, 'open').mockResolvedValueOnce({
      stream: Readable.from([original]),
      contentType: 'audio/ogg',
    });
    const prepared = await service.prepare(
      { media: 'https://fixture.invalid/one-use', mediatype: 'audio' },
      'media',
      execution(),
    );
    const body = prepared.body({
      media: 'https://fixture.invalid/now-changed',
      mediatype: 'audio',
    });
    const chunks: Buffer[] = [];
    for await (const chunk of body.stream) chunks.push(chunk as Buffer);
    const received = JSON.parse(Buffer.concat(chunks).toString()) as {
      media: string;
      mimetype: string;
    };
    expect(Buffer.from(received.media, 'base64')).toEqual(original);
    expect(received.mimetype).toBe('audio/ogg');
    expect(open).toHaveBeenCalledTimes(1);
    await prepared.dispose();
  });

  it('cleans partial files on source interruption and storage failure', async () => {
    jest.spyOn(sources, 'open').mockResolvedValue({
      stream: Readable.from(
        (function* () {
          yield Buffer.from('partial');
          throw new Error('fixture network failure');
        })(),
      ),
    });
    await expect(
      service.prepare(
        { media: 'https://fixture.invalid/a' },
        'media',
        execution(),
      ),
    ).rejects.toMatchObject({ status: 502 });
    expect(await binaries()).toEqual([]);
    jest
      .spyOn(store, 'create')
      .mockRejectedValue(
        Object.assign(new Error('fixture full disk'), { code: 'ENOSPC' }),
      );
    await expect(
      service.prepare({ media: 'TQ==' }, 'media', execution()),
    ).rejects.toMatchObject({ status: 503 });
    expect(await binaries()).toEqual([]);
  });

  it('cleans the file when a serialized body is abandoned part way through', async () => {
    const prepared = await service.prepare(
      { media: Buffer.alloc(200000).toString('base64') },
      'media',
      execution(),
    );
    const body = prepared.body({});
    for await (const chunk of body.stream) {
      expect(chunk).toBeInstanceOf(Buffer);
      break;
    }
    await prepared.dispose();
    await prepared.dispose();
    expect(await binaries()).toEqual([]);
    expect(() => prepared.body({})).toThrow('disposed');
  });

  it('preserves the reference URL name inference and explicit metadata', () => {
    expect(
      evolutionMediaDefaults(
        { mediatype: 'document' },
        'media',
        'https://fixture.invalid/relatório.pdf',
        'application/pdf',
      ),
    ).toEqual({ fileName: 'relatório', mimetype: 'application/pdf' });
    expect(
      evolutionMediaDefaults(
        { mediatype: 'video' },
        'media',
        'https://fixture.invalid/m',
      ),
    ).toEqual({ fileName: 'video.mp4' });
    expect(
      evolutionMediaDefaults(
        { mediatype: 'image', fileName: 'a.png', mimetype: 'image/png' },
        'media',
        'https://fixture.invalid/m',
        'image/jpeg',
      ),
    ).toEqual({});
  });

  it('includes validation in the original budget and never dispatches after cancellation', async () => {
    const context = execution();
    context.disconnect();
    await expect(
      service.prepare({ media: 'TQ==' }, 'media', context),
    ).rejects.toMatchObject({ reason: 'client_disconnected' });
    await expect(inspectBase64('TQ==', 0, execution())).rejects.toMatchObject({
      status: 413,
    });
    expect(await binaries()).toEqual([]);
  });
});
