import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtGuard } from '../../../auth/jwt.guard';
import { EvolutionsService } from './evolutions.service';
import {
  AllocationDto,
  AllocationResponseDto,
  allocationSchema,
  AttachEvolutionDto,
  attachEvolutionSchema,
  EvolutionInputPipe,
  EvolutionLinkResponseDto,
  ImportCandidatesResponseDto,
  RevisionDto,
  revisionQuerySchema,
  UpdateEvolutionLinkDto,
  updateLinkSchema,
} from './evolution.dto';

@ApiTags('Admin — Product Evolutions')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@ApiResponse({ status: 400, description: 'Campos inválidos ou fora do escopo' })
@ApiResponse({ status: 401, description: 'JWT administrativo obrigatório' })
@ApiResponse({ status: 404, description: 'Produto/vínculo não encontrado' })
@ApiResponse({
  status: 409,
  description: 'Revisão antiga, uso ou preparação incompatível',
})
@Controller('admin/products/:productId')
export class ProductEvolutionsController {
  constructor(private readonly service: EvolutionsService) {}

  @Get('evolutions')
  @ApiResponse({ status: 200, type: [EvolutionLinkResponseDto] })
  links(@Param('productId') productId: string) {
    return this.service.links(productId);
  }

  @Post('evolutions/attach')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Vincular Evolution existente; vínculo novo começa pausado',
  })
  @ApiResponse({ status: 200, type: EvolutionLinkResponseDto })
  attach(
    @Param('productId') productId: string,
    @Body(new EvolutionInputPipe(attachEvolutionSchema))
    dto: AttachEvolutionDto,
  ) {
    return this.service.attach(productId, dto);
  }

  @Get('evolutions/:providerId/import-candidates')
  @ApiOperation({
    summary:
      'Candidatos do inventário persistido sem sessões de outros produtos',
  })
  @ApiResponse({ status: 200, type: ImportCandidatesResponseDto })
  candidates(
    @Param('productId') productId: string,
    @Param('providerId') providerId: string,
  ) {
    return this.service.candidates(productId, providerId);
  }

  @Put('evolutions/:providerId')
  @ApiOperation({ summary: 'Editar somente prioridade/admissão do vínculo' })
  @ApiResponse({ status: 200, type: EvolutionLinkResponseDto })
  updateLink(
    @Param('productId') productId: string,
    @Param('providerId') providerId: string,
    @Body(new EvolutionInputPipe(updateLinkSchema)) dto: UpdateEvolutionLinkDto,
  ) {
    return this.service.updateLink(productId, providerId, dto);
  }

  @Delete('evolutions/:providerId')
  @HttpCode(204)
  @ApiQuery({ name: 'expectedRevision', type: Number, required: true })
  @ApiOperation({
    summary: 'Remover vínculo sem uso, preservando instalação e histórico',
  })
  @ApiResponse({ status: 204, description: 'Vínculo removido' })
  detach(
    @Param('productId') productId: string,
    @Param('providerId') providerId: string,
    @Query(new EvolutionInputPipe(revisionQuerySchema)) query: RevisionDto,
  ) {
    return this.service.detach(productId, providerId, query.expectedRevision);
  }

  @Get('instances/placements')
  @ApiOperation({
    summary: 'Destinos das instâncias por Hub ID; somente banco',
  })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          instanceId: { type: 'string' },
          vpsProviderId: { type: 'string' },
          label: { type: 'string' },
          providerUrl: { type: 'string' },
          vpsId: { type: 'string' },
        },
      },
    },
  })
  placements(@Param('productId') productId: string) {
    return this.service.placements(productId);
  }

  @Get('allocation')
  @ApiOperation({
    summary: 'Consultar preparação da distribuição sem ativar controles',
  })
  @ApiResponse({ status: 200, type: AllocationResponseDto })
  allocation(@Param('productId') productId: string) {
    return this.service.allocation(productId);
  }

  @Put('allocation')
  @ApiOperation({ summary: 'Alterar modo explicitamente sem mover instâncias' })
  @ApiResponse({ status: 200, type: AllocationResponseDto })
  setAllocation(
    @Param('productId') productId: string,
    @Body(new EvolutionInputPipe(allocationSchema)) dto: AllocationDto,
  ) {
    return this.service.setAllocation(productId, dto);
  }
}
