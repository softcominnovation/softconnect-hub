import { ConfigService } from '@nestjs/config';

export function parseRedisConnection(config: ConfigService): {
  host: string;
  port: number;
  password?: string;
  db?: number;
} {
  const raw = config.getOrThrow<string>('REDIS_URL');
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379'),
    password: url.password || undefined,
    db:
      url.pathname && url.pathname !== '/'
        ? parseInt(url.pathname.slice(1))
        : 0,
  };
}
