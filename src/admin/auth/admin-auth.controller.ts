import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: { secret: string }): { access_token: string } {
    return this.adminAuthService.login(body.secret);
  }
}
