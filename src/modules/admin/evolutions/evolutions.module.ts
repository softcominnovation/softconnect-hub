import { Module } from '@nestjs/common';
import { AuthModule } from '../../../auth/auth.module';
import { CacheModule } from '../../../cache/cache.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ProvisioningModule } from '../../provisioning/provisioning.module';
import { VpsModule } from '../vps/vps.module';
import { EvolutionsController } from './evolutions.controller';
import { ProductEvolutionsController } from './product-evolutions.controller';
import { EvolutionsService } from './evolutions.service';

@Module({
  imports: [
    AuthModule,
    CacheModule,
    PrismaModule,
    ProvisioningModule,
    VpsModule,
  ],
  controllers: [EvolutionsController, ProductEvolutionsController],
  providers: [EvolutionsService],
})
export class EvolutionsModule {}
