import { Module } from '@nestjs/common';
import { CacheModule } from '../../cache/cache.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProviderModule } from '../../providers/provider.module';
import { ResolverModule } from '../../resolver/resolver.module';
import { InstanceController } from './instance.controller';
import { InstanceService } from './instance.service';
import { ProvisioningModule } from '../provisioning/provisioning.module';

@Module({
  imports: [
    PrismaModule,
    CacheModule,
    ProviderModule,
    ResolverModule,
    ProvisioningModule,
  ],
  controllers: [InstanceController],
  providers: [InstanceService],
  exports: [InstanceService],
})
export class InstanceModule {}
