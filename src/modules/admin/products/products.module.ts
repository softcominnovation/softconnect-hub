import { Module } from '@nestjs/common';
import { AuthModule } from '../../../auth/auth.module';
import { ProviderModule } from '../../../providers/provider.module';
import { ResolverModule } from '../../../resolver/resolver.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [AuthModule, ProviderModule, ResolverModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
