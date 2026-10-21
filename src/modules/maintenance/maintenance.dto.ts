import { z } from 'zod';

export const maintenancePolicySchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    expectedProviderRevision: z.number().int().nonnegative(),
    expectedScopeFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    enabled: z.boolean(),
    mode: z.enum(['observe', 'execute']),
    action: z.enum(['disconnect', 'delete']),
    connectingMaxAgeMinutes: z.number().int().min(1).max(525600).nullable(),
    confirmation: z
      .object({
        action: z.enum(['disconnect', 'delete']),
        acknowledgeSharedScope: z.literal(true),
        acknowledgePermanentDeletion: z.literal(true).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type MaintenancePolicyInput = z.infer<typeof maintenancePolicySchema>;
export const maintenancePageSchema = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
