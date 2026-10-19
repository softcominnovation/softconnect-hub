import { Module } from '@nestjs/common';
import { EvolutionAdapter } from './evolution.adapter';
import { EvolutionHttpService } from './evolution.http';
import { EvolutionMediaService } from './evolution.media';
import { MediaModule } from '../../modules/media/media.module';

@Module({
  imports: [MediaModule],
  providers: [EvolutionHttpService, EvolutionMediaService, EvolutionAdapter],
  exports: [EvolutionAdapter, EvolutionHttpService],
})
export class EvolutionModule {}
