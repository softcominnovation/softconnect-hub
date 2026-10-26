import { z } from 'zod';

// Only bounded, non-secret evidence belongs in the provisioning journal.
const outcomeSchema = z.object({
  result: z.enum(['not_sent', 'unknown', 'rejected', 'succeeded']),
  code: z.enum([
    'before_dispatch',
    'dispatch_started',
    'upstream_unclassified',
    'transport_unknown',
    'invalid_integration',
    'remote_success',
  ]),
  observedAt: z.string().datetime(),
  deadlineAt: z.string().datetime(),
  status: z.number().int().min(100).max(599).optional(),
  remoteId: z.string().min(1).max(256).optional(),
});
export type CreateOutcome = z.infer<typeof outcomeSchema>;
export const evidenceSchema = z.object({
  version: z.literal(1),
  create: outcomeSchema.optional(),
  recovery: z
    .object({ code: z.string().max(100), observedAt: z.string().datetime() })
    .optional(),
  resolution: z
    .object({
      action: z.enum(['reconcile', 'release_absent']),
      actor: z.string().max(256),
      reason: z.string().max(500),
      observedAt: z.string().datetime(),
      expectedRevision: z.number().int(),
      acknowledged: z.boolean(),
      executorsDrained: z.boolean(),
    })
    .optional(),
});
export type ProvisioningEvidence = z.infer<typeof evidenceSchema>;
export function readEvidence(value: unknown): ProvisioningEvidence {
  const parsed = evidenceSchema.safeParse(value);
  return parsed.success ? parsed.data : { version: 1 };
}
export function rejectedBeforeCreate(status: number, body: unknown): boolean {
  // Evolution's native controller rejects an unknown integration before allocating
  // an instance ID or saving a session. No blanket classification of HTTP 4xx.
  const parsed = z
    .object({
      status: z.literal(400),
      error: z.literal('Bad Request'),
      response: z
        .object({ message: z.tuple([z.literal('Invalid integration')]) })
        .strict(),
    })
    .strict()
    .safeParse(body);
  return status === 400 && parsed.success;
}
