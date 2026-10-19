import { createReadStream } from 'node:fs';
import { Readable, addAbortSignal } from 'node:stream';
import { finished } from 'node:stream/promises';

export type MediaField = 'media' | 'sticker';

/** Internal transport only: never expose paths/streams in a public DTO. */
export class PreparedMedia {
  private readonly streams = new Set<Readable>();
  private disposed = false;

  constructor(
    private readonly path: string,
    readonly bytes: number,
    readonly field: MediaField,
    readonly defaults: Readonly<Record<string, string>>,
    private readonly cleanup: () => Promise<void>,
    private readonly signal: AbortSignal,
  ) {}

  body(payload: Record<string, unknown>): {
    stream: Readable;
    contentLength: number;
    headers: { 'Content-Type': string; 'Content-Length': string };
  } {
    if (this.disposed) throw new Error('Media was already disposed');
    this.signal.throwIfAborted();
    const fields = { ...payload };
    for (const [key, value] of Object.entries(this.defaults)) {
      if (!fields[key]) fields[key] = value;
    }
    // Avoid stringifying the input media (which may itself be a large base64 string).
    const entries: string[] = [];
    for (const [key, value] of Object.entries(fields)) {
      if (key === this.field) continue;
      const serialized = JSON.stringify(value);
      if (serialized !== undefined)
        entries.push(`${JSON.stringify(key)}:${serialized}`);
    }
    const prefix = `{${entries.length ? entries.join(',') + ',' : ''}${JSON.stringify(this.field)}:"`;
    const suffix = '"}';
    const path = this.path;
    const signal = this.signal;
    async function* json(): AsyncGenerator<Buffer | string> {
      yield prefix;
      const file = createReadStream(path, { highWaterMark: 64 * 1024, signal });
      let carry = Buffer.alloc(0);
      try {
        for await (const value of file) {
          const chunk = value as Buffer;
          const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
          const aligned = data.length - (data.length % 3);
          if (aligned) yield data.subarray(0, aligned).toString('base64');
          carry = Buffer.from(data.subarray(aligned));
        }
        if (carry.length) yield carry.toString('base64');
        yield suffix;
      } finally {
        file.destroy();
        await finished(file).catch(() => undefined);
      }
    }
    const stream = addAbortSignal(
      signal,
      Readable.from(json(), { objectMode: false, highWaterMark: 64 * 1024 }),
    );
    this.streams.add(stream);
    stream.once('close', () => this.streams.delete(stream));
    const contentLength =
      Buffer.byteLength(prefix) +
      4 * Math.ceil(this.bytes / 3) +
      Buffer.byteLength(suffix);
    return {
      stream,
      contentLength,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(contentLength),
      },
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await Promise.all(
      [...this.streams].map(async (stream) => {
        const closed = finished(stream).catch(() => undefined);
        stream.destroy();
        await closed;
      }),
    );
    await this.cleanup();
  }
}
