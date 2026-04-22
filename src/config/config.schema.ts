import { z } from 'zod';

export const configSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  REDIS_URL: z.string().min(1, 'REDIS_URL é obrigatória'),
  ENCRYPTION_KEY: z
    .string()
    .length(
      64,
      'ENCRYPTION_KEY deve ter exatamente 64 caracteres hex (32 bytes para AES-256-GCM)',
    ),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET deve ter no mínimo 16 caracteres'),
  ADMIN_SECRET: z
    .string()
    .min(8, 'ADMIN_SECRET deve ter no mínimo 8 caracteres'),
  ADMIN_JWT_EXPIRY: z.coerce.number().int().positive().default(86400),
  DEFAULT_RATE_LIMIT: z.coerce.number().int().positive().default(100),
  PROXY_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  PROXY_MAX_RETRIES: z.coerce.number().int().min(0).default(1),
  CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().int().positive().default(5),
  CIRCUIT_BREAKER_RESET_MS: z.coerce.number().int().positive().default(30000),
  AUDIT_FLUSH_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  AUDIT_FLUSH_BATCH_SIZE: z.coerce.number().int().positive().default(100),
  DEFAULT_ADAPTER_TYPE: z.string().default('evolution'),
  ALLOW_BOOTSTRAP: z
    .string()
    .optional()
    .transform((v) => v !== 'false')
    .default(true),
});

export type AppConfig = z.infer<typeof configSchema>;
