import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const integer = (value: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(value);
const boolean = (value: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(value)
    .transform((v) => v === 'true');

export const maintenanceConfigShape = {
  MAINTENANCE_ENABLED: boolean('false'),
  MAINTENANCE_DRY_RUN: boolean('true'),
  MAINTENANCE_INTERVAL_MS: integer(60000, 1000, 3600000),
  MAINTENANCE_CONNECTING_MAX_AGE_MINUTES: integer(480, 1, 525600),
  MAINTENANCE_MAX_OBSERVATION_GAP_MS: integer(180000, 2000, 86400000),
  MAINTENANCE_PROVIDER_CONCURRENCY: integer(1, 1, 4),
  MAINTENANCE_HTTP_TIMEOUT_MS: integer(10000, 100, 30000),
  MAINTENANCE_CYCLE_TIMEOUT_MS: integer(120000, 1000, 600000),
  MAINTENANCE_MAX_ACTIONS_PER_CYCLE: integer(3, 1, 100),
  MAINTENANCE_HISTORY_RETENTION_DAYS: integer(30, 1, 3650),
};

export function maintenanceSettings(config: ConfigService) {
  return {
    enabled: config.get<boolean>('MAINTENANCE_ENABLED', false),
    dryRun: config.get<boolean>('MAINTENANCE_DRY_RUN', true),
    interval: config.get<number>('MAINTENANCE_INTERVAL_MS', 60000),
    age: config.get<number>('MAINTENANCE_CONNECTING_MAX_AGE_MINUTES', 480),
    gap: config.get<number>('MAINTENANCE_MAX_OBSERVATION_GAP_MS', 180000),
    concurrency: config.get<number>('MAINTENANCE_PROVIDER_CONCURRENCY', 1),
    httpTimeout: config.get<number>('MAINTENANCE_HTTP_TIMEOUT_MS', 10000),
    cycleTimeout: config.get<number>('MAINTENANCE_CYCLE_TIMEOUT_MS', 120000),
    maxActions: config.get<number>('MAINTENANCE_MAX_ACTIONS_PER_CYCLE', 3),
    retention: config.get<number>('MAINTENANCE_HISTORY_RETENTION_DAYS', 30),
  };
}

export const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const PENDING_ACTIONS = [
  'dispatching',
  'confirming',
  'uncertain',
  'local_cleanup_pending',
];
export const HEARTBEAT_KEY = 'maintenance:heartbeat:v1';
export const LEASE_MS = 180000;

export function manualLeases(
  value: unknown,
  now: Date,
): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, expiry]) => typeof expiry === 'number' && expiry > now.getTime(),
    ),
  ) as Record<string, number>;
}
