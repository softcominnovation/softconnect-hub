import { Module } from '@nestjs/common';
import { CacheModule } from '../../cache/cache.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProviderModule } from '../../providers/provider.module';
import { EvolutionInventoryService } from './evolution-inventory.service';
import { EvolutionProvisioningService } from './evolution-provisioning.service';
import { EvolutionRecoveryService } from './evolution-recovery.service';

@Module({
  imports: [PrismaModule, CacheModule, ProviderModule],
  providers: [
    EvolutionInventoryService,
    EvolutionProvisioningService,
    EvolutionRecoveryService,
  ],
  exports: [
    EvolutionInventoryService,
    EvolutionProvisioningService,
    EvolutionRecoveryService,
  ],
})
export class ProvisioningModule {}
