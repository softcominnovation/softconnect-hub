import { Module } from '@nestjs/common';
import { MediaPreparationService } from './media-preparation.service';
import { MediaSourceClient } from './media-source.client';
import { MediaSourcePolicy } from './media-source-policy';
import { MediaTempStore } from './media-temp-store';

// Shared by the Evolution adapter in both API and batch runtimes.
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
