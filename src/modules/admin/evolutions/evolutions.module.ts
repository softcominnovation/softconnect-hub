import { Module } from '@nestjs/common';
import { MaintenanceModule } from '../../maintenance/maintenance.module';
import { AuthModule } from '../../../auth/auth.module';
import { CacheModule } from '../../../cache/cache.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ProvisioningModule } from '../../provisioning/provisioning.module';
import { VpsModule } from '../vps/vps.module';
import { EvolutionsController } from './evolutions.controller';
import { ProductEvolutionsController } from './product-evolutions.controller';
import { EvolutionsService } from './evolutions.service';
import { ProductsModule } from '../products/products.module';
import { EvolutionChangesController } from './evolution-changes.controller';
import { EvolutionChangesService } from './evolution-changes.service';
import { EvolutionSetupService } from './evolution-setup.service';

@Module({
  imports: [
    MaintenanceModule,
    AuthModule,
    CacheModule,
    PrismaModule,
    ProvisioningModule,
    VpsModule,
    ProductsModule,
  ],
  controllers: [
    EvolutionsController,
    ProductEvolutionsController,
    EvolutionChangesController,
  ],
  providers: [
    EvolutionsService,
    EvolutionChangesService,
    EvolutionSetupService,
  ],
})
export class EvolutionsModule {}
