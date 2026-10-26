import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import { JwtGuard } from '../../../auth/jwt.guard';
import { ProvisioningResolutionService } from '../../provisioning/provisioning-resolution.service';
import type { ResolutionInput } from '../../provisioning/provisioning-resolution.service';
import { EvolutionInputPipe } from './evolution.dto';

export const resolutionSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    action: z.enum(['reconcile', 'release_absent']),
    reason: z.string().trim().min(1).max(500),
    acknowledgeUncertainOutcome: z.boolean().optional(),
    confirmExecutorsDrained: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.action !== 'release_absent' ||
      value.acknowledgeUncertainOutcome === true,
    'Confirmação da incerteza obrigatória',
  );
export const provisioningQuerySchema = z
  .object({
    state: z.enum(['open', 'all']).default('open'),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

@ApiTags('Admin — Provisioning resolution')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@ApiResponse({
  status: 409,
  description:
    'Revisão/estado alterado, executor ativo ou ausência não confirmada',
})
@ApiResponse({ status: 401, description: 'JWT administrativo obrigatório' })
@Controller('admin/evolutions/:providerId/provisioning')
export class ProvisioningResolutionController {
  constructor(private readonly service: ProvisioningResolutionService) {}
  @Get()
  @ApiQuery({ name: 'state', required: false, enum: ['open', 'all'] })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Default 20, máximo 100',
  })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiOperation({
    summary:
      'Consultar pendências e evidências sanitizadas, sem consulta à Evolution',
  })
  list(
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Query(new EvolutionInputPipe(provisioningQuerySchema))
    query: z.infer<typeof provisioningQuerySchema>,
  ) {
    return this.service.list(providerId, query);
  }
  @Post(':provisioningId/resolve')
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['expectedRevision', 'action', 'reason'],
      properties: {
        expectedRevision: { type: 'integer', minimum: 0 },
        action: { type: 'string', enum: ['reconcile', 'release_absent'] },
        reason: { type: 'string', minLength: 1, maxLength: 500 },
        acknowledgeUncertainOutcome: {
          type: 'boolean',
          description: 'Obrigatório true para release_absent',
        },
        confirmExecutorsDrained: {
          type: 'boolean',
          description:
            'Confirmação operacional obrigatória para histórico sem prazo conhecido',
        },
      },
    },
  })
  @ApiOperation({
    summary:
      'Reconciliar ou liberar ausência confirmada; ação administrativa auditada',
  })
  resolve(
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Param('provisioningId', ParseUUIDPipe) id: string,
    @Body(new EvolutionInputPipe(resolutionSchema)) input: ResolutionInput,
    @Req() request: { admin: { sub?: string } },
  ) {
    return this.service.resolve(
      providerId,
      id,
      input,
      request.admin.sub ?? 'authenticated-admin',
    );
  }
}
