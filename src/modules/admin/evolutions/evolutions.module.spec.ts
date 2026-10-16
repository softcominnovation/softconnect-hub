import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CacheService } from '../../../cache/cache.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdapterResolverService } from '../../../providers/adapter-resolver.service';
import { EvolutionsModule } from './evolutions.module';
import { EvolutionChangesService } from './evolution-changes.service';
import { EvolutionSetupService } from './evolution-setup.service';

describe('Evolution administration module', () => {
  it('resolves the production dependency graph without connecting to external services', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        EvolutionsModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(CacheService)
      .useValue({})
      .overrideProvider(AdapterResolverService)
      .useValue({})
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          ENCRYPTION_KEY: 'a'.repeat(64),
          RUNTIME_MODE: 'worker-batch',
        }),
      )
      .compile();
    expect(module.get(EvolutionChangesService)).toBeInstanceOf(
      EvolutionChangesService,
    );
    expect(module.get(EvolutionSetupService)).toBeInstanceOf(
      EvolutionSetupService,
    );
    await module.close();
  });
});
