import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configSchema } from './config.schema';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => {
        const result = configSchema.safeParse(config);
        if (!result.success) {
          const errors = result.error.issues
            .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
            .join('\n');
          throw new Error(`Variáveis de ambiente inválidas:\n${errors}`);
        }
        return result.data;
      },
    }),
  ],
})
export class AppConfigModule {}
