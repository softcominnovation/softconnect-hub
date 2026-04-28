import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Queue } from 'bullmq';
import { IpWhitelistGuard } from '../auth/ip-whitelist.guard';
import { RELAY_QUEUE } from './queue.constants';
import type { RelayJobPayload } from './relay.worker';

@ApiExcludeController()
@UseGuards(IpWhitelistGuard)
@Controller('internal/webhook')
export class InternalWebhookController {
  constructor(@Inject(RELAY_QUEUE) private readonly relayQueue: Queue) {}

  @Post(':adapterType')
  @HttpCode(HttpStatus.OK)
  receive(
    @Param('adapterType') adapterType: string,
    @Body() body: Record<string, unknown>,
  ): { received: true } {
    const instanceName =
      typeof body['instance'] === 'string' ? body['instance'] : '';
    const payload: RelayJobPayload = { adapterType, instanceName, body };

    void this.relayQueue.add('relay', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    });

    return { received: true };
  }
}
