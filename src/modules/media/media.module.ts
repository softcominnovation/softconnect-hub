import { Module } from '@nestjs/common';
import { MediaPreparationService } from './media-preparation.service';
import { MediaSourceClient } from './media-source.client';
import { MediaSourcePolicy } from './media-source-policy';
import { MediaTempStore } from './media-temp-store';

// Imported by the production message/batch modules during MID-03 integration.
@Module({
  providers: [
    MediaSourcePolicy,
    MediaSourceClient,
    MediaTempStore,
    MediaPreparationService,
  ],
  exports: [MediaPreparationService],
})
export class MediaModule {}
