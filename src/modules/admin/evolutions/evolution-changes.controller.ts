import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtGuard } from '../../../auth/jwt.guard';
import { EvolutionInputPipe } from './evolution.dto';
import { EvolutionChangesService } from './evolution-changes.service';
import { EvolutionSetupService } from './evolution-setup.service';
import {
  CallbackCheckDto,
  callbackCheckSchema,
  EvolutionChangeDto,
  evolutionChangeSchema,
  OperationRevisionDto,
  operationRevisionSchema,
  RetirementDto,
  retirementSchema,
  SetupConfirmationDto,
  setupConfirmationSchema,
} from './evolution-changes.dto';
import type { EvolutionChangeInput } from './evolution-changes.dto';
import {
  EvolutionChangeResponseDto,
  EvolutionChangesResponseDto,
  EvolutionSetupResponseDto,
  EvolutionRemovalResponseDto,
} from './evolution-changes.dto';

type AdminRequest = { admin: { sub?: string; role?: string } };
// JwtGuard remains the authority. Machine and user JWTs follow the same existing policy.
const actor = (request: AdminRequest) =>
  request.admin.sub ?? 'authenticated-admin';

@ApiTags('Admin — Evolution activation')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@ApiResponse({ status: 400, description: 'Campos inválidos ou não permitidos' })
@ApiResponse({ status: 401, description: 'JWT administrativo obrigatório' })
@ApiResponse({
  status: 404,
  description: 'Produto, operação ou Evolution não encontrado',
})
@ApiResponse({
  status: 409,
  description: 'Revisão alterada ou condição de segurança pendente',
})
@Controller('admin')
export class EvolutionChangesController {
  constructor(
    private readonly changes: EvolutionChangesService,
    private readonly setup: EvolutionSetupService,
  ) {}

  @Get('evolution-setup')
  @ApiResponse({ status: 200, type: EvolutionSetupResponseDto })
  @ApiOperation({
    summary: 'Consultar preparação técnica do ambiente sem chamadas remotas',
  })
  setupState() {
    return this.setup.state();
  }

  @Put('evolution-setup/confirmation')
  @ApiResponse({ status: 200, type: EvolutionSetupResponseDto })
  @ApiOperation({
    summary:
      'Registrar declaração administrativa de compatibilidade dos escritores',
  })
  confirm(
    @Body(new EvolutionInputPipe(setupConfirmationSchema))
    dto: SetupConfirmationDto,
    @Req() request: AdminRequest,
  ) {
    return this.setup.confirm(dto, actor(request));
  }

  @Post('products/:productId/evolution-changes')
  @HttpCode(202)
  @ApiBody({ type: EvolutionChangeDto })
  @ApiResponse({
    status: 202,
    type: EvolutionChangeResponseDto,
    description: 'Rascunho persistido; política ativa preservada',
  })
  create(
    @Param('productId') productId: string,
    @Body(new EvolutionInputPipe(evolutionChangeSchema))
    dto: EvolutionChangeInput,
    @Req() request: AdminRequest,
  ) {
    return this.changes.create(productId, dto, actor(request));
  }

  @Get('products/:productId/evolution-changes')
  @ApiResponse({ status: 200, type: EvolutionChangesResponseDto })
  list(@Param('productId') productId: string) {
    return this.changes.list(productId);
  }

  @Get('products/:productId/evolution-changes/:operationId')
  @ApiResponse({ status: 200, type: EvolutionChangeResponseDto })
  get(@Param('productId') productId: string, @Param('operationId') id: string) {
    return this.changes.get(productId, id);
  }

  @Post('products/:productId/evolution-changes/:operationId/apply')
  @ApiResponse({ status: 200, type: EvolutionChangeResponseDto })
  @HttpCode(200)
  @ApiOperation({
    summary: 'Revalidar e aplicar a configuração local atomicamente',
  })
  apply(
    @Param('productId') productId: string,
    @Param('operationId') id: string,
    @Body(new EvolutionInputPipe(operationRevisionSchema))
    dto: OperationRevisionDto,
    @Req() request: AdminRequest,
  ) {
    return this.changes.apply(
      productId,
      id,
      dto.expectedOperationRevision,
      actor(request),
    );
  }

  @Post('products/:productId/evolution-changes/:operationId/cancel')
  @ApiResponse({ status: 200, type: EvolutionChangeResponseDto })
  @HttpCode(200)
  cancel(
    @Param('productId') productId: string,
    @Param('operationId') id: string,
    @Body(new EvolutionInputPipe(operationRevisionSchema))
    dto: OperationRevisionDto,
    @Req() request: AdminRequest,
  ) {
    return this.changes.cancel(
      productId,
      id,
      dto.expectedOperationRevision,
      actor(request),
    );
  }

  @Post('products/:productId/evolution-changes/:operationId/callback-check')
  @ApiResponse({ status: 202, type: EvolutionChangeResponseDto })
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Autorizar sincronização de uma instância própria; não confirma recebimento de evento',
  })
  callback(
    @Param('productId') productId: string,
    @Param('operationId') id: string,
    @Body(new EvolutionInputPipe(callbackCheckSchema)) dto: CallbackCheckDto,
    @Req() request: AdminRequest,
  ) {
    return this.changes.callbackCheck(productId, id, dto, actor(request));
  }

  @Get('evolutions/:providerId/removal-readiness')
  @ApiResponse({ status: 200, type: EvolutionRemovalResponseDto })
  removal(@Param('providerId') id: string) {
    return this.setup.removal(id);
  }

  @Post('evolutions/:providerId/retirement')
  @ApiResponse({ status: 200, type: EvolutionRemovalResponseDto })
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Desativar logicamente cadastro sem uso; não exclui sessões ou provider remoto',
  })
  retirement(
    @Param('providerId') id: string,
    @Body(new EvolutionInputPipe(retirementSchema)) dto: RetirementDto,
    @Req() request: AdminRequest,
  ) {
    return this.setup.retire(id, dto, actor(request));
  }
}
