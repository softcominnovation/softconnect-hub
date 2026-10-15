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
  catalogQuerySchema,
  createEvolutionSchema,
  updateEvolutionSchema,
  revisionBodySchema,
  revisionQuerySchema,
  EvolutionInputPipe,
  CreateEvolutionDto,
  UpdateEvolutionDto,
  RevisionDto,
  EvolutionResponseDto,
  OccupancyResponseDto,
  ReconciliationResponseDto,
} from './evolution.dto';

@ApiTags('Admin — Evolutions')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@ApiResponse({ status: 400, description: 'Campos inválidos ou fora do escopo' })
@ApiResponse({ status: 401, description: 'JWT administrativo obrigatório' })
@ApiResponse({ status: 404, description: 'Recurso não encontrado' })
@ApiResponse({
  status: 409,
  description: 'Revisão antiga, uso ou preparação incompatível',
})
@Controller('admin/evolutions')
export class EvolutionsController {
  constructor(private readonly service: EvolutionsService) {}

  @Get()
  @ApiOperation({ summary: 'Catálogo global de Evolutions sem credenciais' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'vpsId', required: false })
  @ApiQuery({ name: 'productId', required: false })
  @ApiQuery({
    name: 'isActive',
    required: false,
    enum: ['true', 'false'],
    description: 'Omissão lista ativos',
  })
  @ApiResponse({ status: 200, type: [EvolutionResponseDto] })
  list(
    @Query(new EvolutionInputPipe(catalogQuerySchema))
    query: {
      search?: string;
      vpsId?: string;
      productId?: string;
      isActive?: boolean;
    },
  ) {
    return this.service.list(query);
  }

  @Post()
  @ApiOperation({
    summary: 'Cadastrar Evolution sem limite ou produto obrigatório',
  })
  @ApiResponse({ status: 201, type: EvolutionResponseDto })
  create(
    @Body(new EvolutionInputPipe(createEvolutionSchema))
    dto: CreateEvolutionDto,
  ) {
    return this.service.create(dto);
  }

  @Get(':providerId/occupancy')
  @ApiOperation({
    summary: 'Ocupação global e idade da evidência, sem consulta remota',
  })
  @ApiResponse({ status: 200, type: OccupancyResponseDto })
  occupancy(@Param('providerId') id: string) {
    return this.service.getOccupancy(id);
  }

  @Post(':providerId/reconcile')
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Registrar reconciliação durável, executada pelo recovery existente',
  })
  @ApiResponse({ status: 202, type: ReconciliationResponseDto })
  reconcile(
    @Param('providerId') id: string,
    @Body(new EvolutionInputPipe(revisionBodySchema)) dto: RevisionDto,
  ) {
    return this.service.reconcile(id, dto.expectedRevision);
  }

  @Get(':providerId/reconciliations/:operationId')
  @ApiOperation({ summary: 'Consultar reconciliação da Evolution' })
  @ApiResponse({ status: 200, type: ReconciliationResponseDto })
  reconciliation(
    @Param('providerId') id: string,
    @Param('operationId') operationId: string,
  ) {
    return this.service.reconciliation(id, operationId);
  }

  @Get(':providerId')
  @ApiResponse({ status: 200, type: EvolutionResponseDto })
  get(@Param('providerId') id: string) {
    return this.service.get(id);
  }

  @Put(':providerId')
  @ApiOperation({
    summary: 'Editar instalação/política global com controle de revisão',
  })
  @ApiResponse({ status: 200, type: EvolutionResponseDto })
  update(
    @Param('providerId') id: string,
    @Body(new EvolutionInputPipe(updateEvolutionSchema))
    dto: UpdateEvolutionDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':providerId')
  @ApiQuery({ name: 'expectedRevision', type: Number, required: true })
  @ApiOperation({
    summary: 'Desativar Evolution sem uso; não exclui fisicamente',
  })
  @ApiResponse({ status: 200, type: EvolutionResponseDto })
  deactivate(
    @Param('providerId') id: string,
    @Query(new EvolutionInputPipe(revisionQuerySchema)) query: RevisionDto,
  ) {
    return this.service.deactivate(id, query.expectedRevision);
  }
}
