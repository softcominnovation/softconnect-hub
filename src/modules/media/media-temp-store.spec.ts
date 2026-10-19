import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaTempStore } from './media-temp-store';

describe('Controlled media temporary storage', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mid02-store-'));
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it('keeps files of an active execution and makes individual cleanup idempotent', async () => {
    const store = new MediaTempStore(
      new ConfigService({ MEDIA_TMP_DIR: root }),
    );
    const first = await store.create();
    const second = await store.create();
    await writeFile(first.path, 'one');
    await writeFile(second.path, 'two');
    expect(first.path).not.toEqual(second.path);
    await store.onModuleDestroy();
    expect(await readFile(first.path, 'utf8')).toBe('one');
    await first.dispose();
    await first.dispose();
    expect(await readFile(second.path, 'utf8')).toBe('two');
    await second.dispose();
    await store.onModuleDestroy();
    await expect(access(second.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('only removes a managed dead process on this host, preserving other owners and symlinks', async () => {
    const namespace = join(root, 'softconnect-media');
    await mkdir(namespace);
    const orphan = join(namespace, `run-123456789-${randomUUID()}`);
    const live = join(namespace, `run-${process.pid}-${randomUUID()}`);
    const foreign = join(namespace, `run-123456789-${randomUUID()}`);
    const unknown = join(namespace, 'unmanaged');
    for (const path of [orphan, live, foreign, unknown]) {
      await mkdir(path);
      await writeFile(join(path, 'keep.bin'), 'fixture');
    }
    await writeFile(
      join(orphan, 'owner.json'),
      JSON.stringify({ hostname: hostname(), pid: 123456789 }),
    );
    await writeFile(
      join(live, 'owner.json'),
      JSON.stringify({ hostname: hostname(), pid: process.pid }),
    );
    await writeFile(
      join(foreign, 'owner.json'),
      JSON.stringify({ hostname: 'foreign-fixture-host', pid: 123456789 }),
    );
    const outside = join(root, 'outside-namespace');
    await mkdir(outside);
    await writeFile(join(outside, 'safe'), 'safe');
    await symlink(
      outside,
      join(namespace, `run-123456789-${randomUUID()}`),
      'junction',
    );
    const originalKill = process.kill.bind(process);
    jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === 123456789)
        throw Object.assign(new Error('fixture dead'), { code: 'ESRCH' });
      return originalKill(pid, signal);
    });
    const store = new MediaTempStore(
      new ConfigService({ MEDIA_TMP_DIR: root }),
    );
    const file = await store.create();
    await expect(access(orphan)).rejects.toMatchObject({ code: 'ENOENT' });
    for (const path of [live, foreign, unknown])
      expect(await readFile(join(path, 'keep.bin'), 'utf8')).toBe('fixture');
    expect(await readFile(join(outside, 'safe'), 'utf8')).toBe('safe');
    await file.dispose();
    await store.onModuleDestroy();
  });
});
