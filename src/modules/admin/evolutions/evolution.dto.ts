import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { canonicalEvolutionEndpoint } from '../../../prisma/evolution-identity';
import { maxInstancesSchema } from '../../../prisma/evolution-policy';

const text = z.string().trim().min(1).max(255);
const revision = z.number().int().min(0).max(2147483647);
const endpoint = z
  .string()
  .max(2048)
  .refine((url) => !!canonicalEvolutionEndpoint(url));
const credential = z
  .string()
  .min(1)
  .max(8192)
  .refine((value) => value.trim().length > 0);

export const createEvolutionSchema = z
  .object({
    vpsId: text,
    label: text,
    providerUrl: endpoint,
    providerApiKey: credential,
    adapterType: z.literal('evolution').optional(),
  })
  .strict();
export const updateEvolutionSchema = createEvolutionSchema
  .partial()
  .extend({
    expectedRevision: revision,
    maxInstances: maxInstancesSchema,
    acceptingNewInstances: z.boolean().optional(),
    isActive: z.boolean().optional(),
    confirmIdentity: z.literal(true).optional(),
    writersCompatible: z.literal(true).optional(),
  })
  .strict();
export const attachEvolutionSchema = z
  .object({
    vpsProviderId: text,
    expectedRevision: revision,
  })
  .strict();
export const updateLinkSchema = z
  .object({
    expectedRevision: revision,
    allocationPriority: revision.optional(),
    acceptingNewInstances: z.boolean().optional(),
  })
  .strict();
export const allocationSchema = z
  .object({
    expectedRevision: revision,
    mode: z.enum(['legacy', 'capacity']),
    writersCompatible: z.literal(true).optional(),
  })
  .strict();
export const revisionBodySchema = z
  .object({ expectedRevision: revision })
  .strict();
export const revisionQuerySchema = z
  .object({
    expectedRevision: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(revision),
  })
  .strict();
export const catalogQuerySchema = z
  .object({
    search: text.optional(),
    vpsId: text.optional(),
    productId: text.optional(),
    isActive: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strict();

export class EvolutionInputPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T>) {}
  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success)
      throw new BadRequestException(
        'Campos inválidos ou não permitidos para esta operação',
      );
    return result.data;
  }
}

export class CreateEvolutionDto {
  @ApiProperty() vpsId!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ example: 'https://evolution.example.invalid' })
  providerUrl!: string;
  @ApiProperty({ writeOnly: true }) providerApiKey!: string;
  @ApiPropertyOptional({ enum: ['evolution'] }) adapterType?: 'evolution';
}
export class UpdateEvolutionDto {
  @ApiProperty({ minimum: 0 }) expectedRevision!: number;
  @ApiPropertyOptional() vpsId?: string;
  @ApiPropertyOptional() label?: string;
  @ApiPropertyOptional() providerUrl?: string;
  @ApiPropertyOptional({
    writeOnly: true,
    description: 'Omissão preserva; vazio é inválido',
  })
  providerApiKey?: string;
  @ApiPropertyOptional({ enum: ['evolution'] }) adapterType?: 'evolution';
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1 })
  maxInstances?: number | null;
  @ApiPropertyOptional() acceptingNewInstances?: boolean;
  @ApiPropertyOptional() isActive?: boolean;
  @ApiPropertyOptional({
    description:
      'Confirmação administrativa da identidade física; somente true',
  })
  confirmIdentity?: true;
  @ApiPropertyOptional({
    description:
      'Todos os escritores atualizados; obrigatório ao definir teto positivo',
  })
  writersCompatible?: true;
}
export class RevisionDto {
  @ApiProperty({ minimum: 0 }) expectedRevision!: number;
}
export class AttachEvolutionDto extends RevisionDto {
  @ApiProperty() vpsProviderId!: string;
}
export class UpdateEvolutionLinkDto extends RevisionDto {
  @ApiPropertyOptional({ minimum: 0 }) allocationPriority?: number;
  @ApiPropertyOptional() acceptingNewInstances?: boolean;
}
export class AllocationDto extends RevisionDto {
  @ApiProperty({ enum: ['legacy', 'capacity'] }) mode!: 'legacy' | 'capacity';
  @ApiPropertyOptional({ description: 'Obrigatório para ativar capacity' })
  writersCompatible?: true;
}

export class EvolutionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() vpsId!: string;
  @ApiProperty() label!: string;
  @ApiProperty() providerUrl!: string;
  @ApiProperty() adapterType!: string;
  @ApiProperty({ type: Number, nullable: true }) maxInstances!: number | null;
  @ApiProperty() acceptingNewInstances!: boolean;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() configurationRevision!: number;
  @ApiProperty() hasProviderCredential!: boolean;
  @ApiProperty() identityStatus!: string;
  @ApiProperty() callbackReadiness!: string;
  @ApiProperty({ type: Object }) health!: object;
  @ApiProperty({ type: Object }) inventory!: object;
  @ApiProperty({ type: Object }) occupancy!: object;
  @ApiProperty({ type: [Object] }) links!: object[];
}
export class EvolutionLinkResponseDto {
  @ApiProperty({
    type: Object,
    description:
      'productId, vpsProviderId, allocationPriority, acceptingNewInstances, configurationRevision',
  })
  link!: object;
  @ApiProperty({ type: EvolutionResponseDto }) evolution!: EvolutionResponseDto;
  @ApiPropertyOptional({
    description: 'Revisão da política após attach/update do vínculo',
  })
  allocationRevision?: number;
}
export class OccupancyResponseDto {
  @ApiProperty() vpsProviderId!: string;
  @ApiProperty() instances!: number;
  @ApiProperty() reservations!: number;
  @ApiProperty() effective!: number;
  @ApiProperty({ type: Object }) byProduct!: object;
  @ApiProperty({ nullable: true, type: Number }) maxInstances!: number | null;
  @ApiProperty() limitConfigured!: boolean;
  @ApiProperty({ nullable: true, type: Number }) available!: number | null;
  @ApiProperty({ nullable: true, type: Boolean }) overLimit!: boolean | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  asOf!: Date | null;
  @ApiProperty({ type: Object }) inventory!: object;
}
export class AllocationResponseDto {
  @ApiProperty({ enum: ['legacy', 'capacity'] }) mode!: string;
  @ApiProperty() configurationRevision!: number;
  @ApiProperty({ type: String, nullable: true }) defaultProviderId!:
    | string
    | null;
  @ApiProperty() distributionEnabled!: boolean;
  @ApiProperty() databaseConsolidated!: boolean;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  capacityFirstAllocationAt!: Date | null;
  @ApiProperty() requiresWriterConfirmation!: boolean;
  @ApiProperty({ type: [String] }) blockers!: string[];
  @ApiProperty({ type: [Object] }) order!: object[];
  @ApiProperty() ready!: boolean;
}
export class ReconciliationResponseDto {
  @ApiProperty() operationId!: string;
  @ApiProperty() vpsProviderId!: string;
  @ApiProperty({ enum: ['pending', 'running', 'completed', 'failed'] })
  status!: string;
  @ApiProperty({ type: String, nullable: true }) errorCode!: string | null;
  @ApiProperty({ type: Object, nullable: true }) result!: object | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  startedAt!: Date | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  finishedAt!: Date | null;
}
export class ImportCandidatesResponseDto {
  @ApiProperty({
    type: [Object],
    description:
      'providerInstanceId, instanceName, status, ownership, hubInstanceId quando próprio',
  })
  items!: object[];
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  asOf!: Date | null;
  @ApiProperty() inventoryStatus!: string;
  @ApiProperty() conflictCount!: number;
}
