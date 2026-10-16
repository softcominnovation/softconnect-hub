import { z } from 'zod';
import { ApiProperty } from '@nestjs/swagger';

const id = z.string().trim().min(1).max(128);
const revision = z.number().int().min(0).max(2147483647);
const limit = z.number().int().min(1).max(2147483647).nullable();
const link = z
  .object({
    vpsProviderId: id,
    expectedRevision: revision.optional(),
    allocationPriority: revision.optional(),
    acceptingNewInstances: z.boolean().optional(),
  })
  .strict();
const providerUpdate = z
  .object({
    vpsProviderId: id,
    expectedRevision: revision,
    maxInstances: limit,
  })
  .strict();
const identity = z
  .object({
    vpsProviderId: id,
    expectedRevision: revision,
    confirmed: z.literal(true),
  })
  .strict();
const impact = z
  .object({
    vpsProviderId: id,
    expectedRevision: revision,
    maxInstances: limit,
    productIds: z.array(id).max(200),
    confirmed: z.literal(true),
  })
  .strict();
export const evolutionChangeSchema = z
  .object({
    requestId: id,
    expectedRevision: revision,
    action: z.enum([
      'configure_capacity',
      'single_destination',
      'restore_legacy',
      'detach',
    ]),
    targetProviderId: id.optional(),
    links: z.array(link).max(50).default([]),
    providerUpdates: z.array(providerUpdate).max(50).default([]),
    confirmations: z
      .object({
        identities: z.array(identity).max(50).default([]),
        sharedLimits: z.array(impact).max(50).default([]),
      })
      .strict()
      .default({ identities: [], sharedLimits: [] }),
  })
  .strict()
  .superRefine((value, ctx) => {
    const invalid = () =>
      ctx.addIssue({
        code: 'custom',
        message: 'Campos incompatíveis com a ação',
      });
    if ((value.action !== 'configure_capacity') !== !!value.targetProviderId)
      invalid();
    if (
      value.action !== 'configure_capacity' &&
      (value.links.length ||
        value.providerUpdates.length ||
        value.confirmations.identities.length ||
        value.confirmations.sharedLimits.length)
    )
      invalid();
    for (const list of [
      value.links,
      value.providerUpdates,
      value.confirmations.identities,
      value.confirmations.sharedLimits,
    ])
      if (new Set(list.map((item) => item.vpsProviderId)).size !== list.length)
        invalid();
    for (const item of value.confirmations.sharedLimits)
      if (new Set(item.productIds).size !== item.productIds.length) invalid();
  });
export type EvolutionChangeInput = z.infer<typeof evolutionChangeSchema>;
export const operationRevisionSchema = z
  .object({ expectedOperationRevision: revision })
  .strict();
export const callbackCheckSchema = operationRevisionSchema
  .extend({ instanceId: id, confirmWebhookUpdate: z.literal(true) })
  .strict();
export const setupConfirmationSchema = z
  .object({ expectedRevision: revision, writersCompatible: z.literal(true) })
  .strict();
export const retirementSchema = z
  .object({ expectedRevision: revision, expectedInventoryRevision: revision })
  .strict();

export class OperationRevisionDto {
  @ApiProperty() expectedOperationRevision!: number;
}
export class CallbackCheckDto extends OperationRevisionDto {
  @ApiProperty() instanceId!: string;
  @ApiProperty({ enum: [true] }) confirmWebhookUpdate!: true;
}
export class SetupConfirmationDto {
  @ApiProperty() expectedRevision!: number;
  @ApiProperty({ enum: [true] }) writersCompatible!: true;
}
export class RetirementDto {
  @ApiProperty() expectedRevision!: number;
  @ApiProperty() expectedInventoryRevision!: number;
}
export class EvolutionChangeDto {
  @ApiProperty() requestId!: string;
  @ApiProperty() expectedRevision!: number;
  @ApiProperty({
    enum: [
      'configure_capacity',
      'single_destination',
      'restore_legacy',
      'detach',
    ],
  })
  action!: string;
  @ApiProperty({ required: false }) targetProviderId?: string;
  @ApiProperty({
    required: false,
    type: [Object],
    description:
      'vpsProviderId, expectedRevision (existente), allocationPriority?, acceptingNewInstances?',
  })
  links?: object[];
  @ApiProperty({
    required: false,
    type: [Object],
    description:
      'vpsProviderId, expectedRevision, maxInstances (null remove teto)',
  })
  providerUpdates?: object[];
  @ApiProperty({
    required: false,
    type: Object,
    description:
      'identities: [{vpsProviderId,expectedRevision,confirmed:true}]; sharedLimits: [{vpsProviderId,expectedRevision,maxInstances,productIds,confirmed:true}]',
  })
  confirmations?: object;
}

export class EvolutionChangeResponseDto {
  @ApiProperty() operationId!: string;
  @ApiProperty() productId!: string;
  @ApiProperty() action!: string;
  @ApiProperty({
    enum: [
      'queued',
      'running',
      'action_required',
      'ready',
      'applied',
      'failed',
      'expired',
      'cancelled',
    ],
  })
  status!: string;
  @ApiProperty() revision!: number;
  @ApiProperty() stage!: string;
  @ApiProperty() actor!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) executionDeadline!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: Date;
  @ApiProperty({ type: [String] }) affectedProducts!: string[];
  @ApiProperty({
    type: [Object],
    description: 'code, message, blocking, observedAt, providerId opcional',
  })
  checks!: object[];
  @ApiProperty({
    type: [Object],
    description:
      'code, destination controlado; providerId, instanceIds e orientação de produto de teste quando aplicáveis',
  })
  requiredActions!: object[];
  @ApiProperty({ type: Object }) draft!: object;
  @ApiProperty({ type: Object, nullable: true }) callback!: object | null;
  @ApiProperty({ type: Object, nullable: true }) result!: object | null;
}
export class EvolutionChangesResponseDto {
  @ApiProperty({ type: [EvolutionChangeResponseDto] })
  items!: EvolutionChangeResponseDto[];
}
export class EvolutionSetupResponseDto {
  @ApiProperty() distributionEnabled!: boolean;
  @ApiProperty() databaseConsolidated!: boolean;
  @ApiProperty() requirementsVersion!: string;
  @ApiProperty() confirmationRequired!: boolean;
  @ApiProperty() revision!: number;
  @ApiProperty({
    type: Object,
    nullable: true,
    description: 'actor e confirmedAt; não contém credenciais',
  })
  confirmation!: object | null;
}
export class EvolutionRemovalResponseDto {
  @ApiProperty() providerId!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() revision!: number;
  @ApiProperty() inventoryRevision!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  inventoryObservedAt!: Date | null;
  @ApiProperty({ type: Object }) usage!: object;
  @ApiProperty({ type: [Object] }) instancesByProduct!: object[];
  @ApiProperty({ type: [String] }) blockers!: string[];
  @ApiProperty() removable!: boolean;
}
