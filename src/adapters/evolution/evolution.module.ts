import { Module } from '@nestjs/common';
import { EvolutionAdapter } from './evolution.adapter';
import { EvolutionHttpService } from './evolution.http';

@Module({
  providers: [EvolutionHttpService, EvolutionAdapter],
  exports: [EvolutionAdapter],
})
export class EvolutionModule {}
