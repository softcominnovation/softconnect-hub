import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { ProviderModule } from '../../providers/provider.module';
import { AdminAdaptersController } from './adapters.controller';

@Module({
  imports: [AuthModule, ProviderModule],
  controllers: [AdminAdaptersController],
})
export class AdminAdaptersModule {}
