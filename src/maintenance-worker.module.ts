import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { MaintenanceWorker } from './modules/maintenance/maintenance.worker';
import { EvolutionMaintenanceClient } from './adapters/evolution/evolution.maintenance';
import { EvolutionProvisioningService } from './modules/provisioning/evolution-provisioning.service';
import { EvolutionInventoryService } from './modules/provisioning/evolution-inventory.service';
@Module({
  imports: [CoreModule],
  providers: [
    MaintenanceWorker,
    EvolutionMaintenanceClient,
    EvolutionProvisioningService,
    EvolutionInventoryService,
  ],
})
export class MaintenanceWorkerModule {}
