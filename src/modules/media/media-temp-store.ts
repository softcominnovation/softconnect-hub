import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

@Injectable()
export class MediaTempStore implements OnModuleDestroy {
  private readonly logger = new Logger(MediaTempStore.name);
  private readonly namespace: string;
  private directory?: Promise<string>;
  private readonly active = new Set<string>();
  private closing = false;

  constructor(config: ConfigService) {
    this.namespace = join(
      resolve(config.get<string>('MEDIA_TMP_DIR') || tmpdir()),
      'softconnect-media',
    );
  }

  private async initialize(): Promise<string> {
    await mkdir(this.namespace, { recursive: true, mode: 0o700 });
    if ((await lstat(this.namespace)).isSymbolicLink())
      throw new Error('Media temporary directory must not be a symlink');
    await this.cleanOrphans();
    const directory = join(
      this.namespace,
      `run-${process.pid}-${randomUUID()}`,
    );
    await mkdir(directory, { mode: 0o700 });
    try {
      await writeFile(
        join(directory, 'owner.json'),
        JSON.stringify({
          hostname: hostname(),
          pid: process.pid,
        }),
        { flag: 'wx', mode: 0o600 },
      );
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
    return directory;
  }

  private async cleanOrphans(): Promise<void> {
    for (const entry of await readdir(this.namespace, {
      withFileTypes: true,
    })) {
      const match = /^run-(\d+)-[0-9a-f-]{36}$/.exec(entry.name);
      if (!match || !entry.isDirectory() || entry.isSymbolicLink()) continue;
      const directory = join(this.namespace, entry.name);
      try {
        const marker = join(directory, 'owner.json');
        const stat = await lstat(marker);
        if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 4096)
          continue;
        const owner = JSON.parse(await readFile(marker, 'utf8')) as {
          hostname?: unknown;
          pid?: unknown;
        };
        if (
          owner.hostname !== hostname() ||
          owner.pid !== Number(match[1]) ||
          !Number.isSafeInteger(owner.pid) ||
          Number(owner.pid) <= 0
        )
          continue;
        try {
          process.kill(Number(owner.pid), 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH')
            await rm(directory, { recursive: true, force: true });
        }
      } catch {
        /* Unknown ownership or permissions: preserve the directory. */
      }
    }
  }

  async create(): Promise<{ path: string; dispose: () => Promise<void> }> {
    if (this.closing) throw new Error('Media temporary storage is closing');
    this.directory ??= this.initialize().catch((error: unknown) => {
      this.directory = undefined;
      throw error;
    });
    const directory = await this.directory;
    if (this.closing) throw new Error('Media temporary storage is closing');
    const path = join(directory, `${randomUUID()}.bin`);
    this.active.add(path);
    let disposed = false;
    return {
      path,
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        try {
          await rm(path, { force: true });
        } catch {
          this.logger.warn('event=media_temp_cleanup_failed');
        } finally {
          this.active.delete(path);
        }
      },
    };
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    if (!this.directory || this.active.size) return;
    const directory = await this.directory;
    if (this.active.size) return;
    await rm(directory, { recursive: true, force: true });
  }
}
