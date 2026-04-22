import { Module } from '@nestjs/common';
import { ApiKeyGuard } from './apikey.guard';
import { IpWhitelistGuard } from './ip-whitelist.guard';
import { JwtGuard } from './jwt.guard';

@Module({
  providers: [JwtGuard, ApiKeyGuard, IpWhitelistGuard],
  exports: [JwtGuard, ApiKeyGuard, IpWhitelistGuard],
})
export class AuthModule {}
