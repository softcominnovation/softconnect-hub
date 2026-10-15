import { isIP } from 'node:net';
import { z } from 'zod';
import { QR_FINISH_MARGIN_MS } from '../common/qr-request-context';

export const configSchema = z
  .object({
    DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
    REDIS_URL: z.string().min(1, 'REDIS_URL é obrigatória'),
    ENCRYPTION_KEY: z
      .string()
      .length(
        64,
        'ENCRYPTION_KEY deve ter exatamente 64 caracteres hex (32 bytes para AES-256-GCM)',
      ),
    JWT_SECRET: z
      .string()
      .min(16, 'JWT_SECRET deve ter no mínimo 16 caracteres'),
    ADMIN_SECRET: z
      .string()
      .min(8, 'ADMIN_SECRET deve ter no mínimo 8 caracteres'),
    ADMIN_JWT_EXPIRY: z.coerce.number().int().positive().default(86400),
    DEFAULT_RATE_LIMIT: z.coerce.number().int().positive().default(100),
    PROXY_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
    QR_REQUEST_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .gt(QR_FINISH_MARGIN_MS)
      .max(2147483647)
      .default(60000),
    QR_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(50000),
    PROXY_MAX_RETRIES: z.coerce.number().int().min(0).default(1),
    CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().int().positive().default(5),
    CIRCUIT_BREAKER_RESET_MS: z.coerce.number().int().positive().default(30000),
    AUDIT_FLUSH_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
    AUDIT_FLUSH_BATCH_SIZE: z.coerce.number().int().positive().default(100),
    DEFAULT_ADAPTER_TYPE: z.string().default('evolution'),
    EVOLUTION_ALLOCATION_ENABLED: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
    EVOLUTION_HEALTH_MAX_AGE_MS: z.coerce
      .number()
      .int()
      .positive()
      .max(2147483647)
      .default(180000),
    EVOLUTION_INVENTORY_MAX_AGE_MS: z.coerce
      .number()
      .int()
      .positive()
      .max(2147483647)
      .default(300000),
    EVOLUTION_RECOVERY_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(2147483647)
      .default(15000),
    EVOLUTION_RECOVERY_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .gt(QR_FINISH_MARGIN_MS)
      .max(2147483647)
      .default(30000),
    ALLOW_BOOTSTRAP: z
      .string()
      .optional()
      .transform((v) => v !== 'false')
      .default(true),
    CACHE_DEBUG: z
      .string()
      .optional()
      .transform((v) => v === 'true')
      .default(false),
    RELAY_DEBUG: z
      .string()
      .optional()
      .transform((v) => v === 'true')
      .default(false),
    HUB_MONITOR_URL: z.string().url().optional(),
    HUB_MONITOR_API_KEY: z.string().optional(),
    RUNTIME_MODE: z.enum(['api', 'worker-batch']).default('api'),
    WORKER_CONCURRENCY: z.coerce.number().min(1).max(100).default(10),
    RELAY_TRUSTED_PROXY_IPS: z
      .string()
      .default('')
      .refine(
        (value) =>
          !value || value.split(',').every((ip) => isIP(ip.trim()) !== 0),
        'Informe IPs de proxies confiáveis separados por vírgula',
      ),
    RELAY_CONCURRENCY: z.coerce.number().min(1).max(100).default(20),
  })
  .refine(
    (config) =>
      config.QR_PROVIDER_TIMEOUT_MS <=
      config.QR_REQUEST_TIMEOUT_MS - QR_FINISH_MARGIN_MS,
    {
      path: ['QR_PROVIDER_TIMEOUT_MS'],
      message:
        'QR_PROVIDER_TIMEOUT_MS deve reservar 1000 ms dentro de QR_REQUEST_TIMEOUT_MS',
    },
  );

export type AppConfig = z.infer<typeof configSchema>;
