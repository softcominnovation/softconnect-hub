import { Module } from '@nestjs/common';
import { MaintenanceGuardModule } from '../../modules/maintenance/maintenance-guard.module';
import { EvolutionAdapter } from './evolution.adapter';
import { EvolutionHttpService } from './evolution.http';
import { EvolutionMediaService } from './evolution.media';
import { MediaModule } from '../../modules/media/media.module';

@Module({
  imports: [MediaModule, MaintenanceGuardModule],
  providers: [EvolutionHttpService, EvolutionMediaService, EvolutionAdapter],
  exports: [EvolutionAdapter, EvolutionHttpService],
})
export class EvolutionModule {}
