import { Module } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module';
import { PrismaModule } from '../prisma/prisma.module';
import { InstanceResolverService } from './instance.resolver';

@Module({
  imports: [CacheModule, PrismaModule],
  providers: [InstanceResolverService],
  exports: [InstanceResolverService],
})
export class ResolverModule {}
