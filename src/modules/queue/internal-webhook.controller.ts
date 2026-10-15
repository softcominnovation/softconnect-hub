import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { RelayRequestOrigin } from '../../common/relay-origin';
import { RelayIngressService } from './relay-ingress.service';

@ApiExcludeController()
@Controller('internal/webhook')
export class InternalWebhookController {
  constructor(private readonly ingress: RelayIngressService) {}

  @Post(':adapterType')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('adapterType') adapterType: string,
    @Body() body: Record<string, unknown>,
    @Req() request: RelayRequestOrigin,
  ): Promise<{ received: true }> {
    await this.ingress.receiveLegacy(adapterType, body, request);
    return { received: true };
  }

  @Post(['evolution/:vpsProviderId', 'evolution/:vpsProviderId/:event'])
  @HttpCode(HttpStatus.OK)
  async receiveAuthenticated(
    @Param('vpsProviderId') providerId: string,
    @Headers('x-hub-relay-token') token: string | undefined,
    @Body() body: Record<string, unknown>,
  ): Promise<{ received: true }> {
    await this.ingress.receiveAuthenticated(providerId, token, body);
    return { received: true };
  }
}
