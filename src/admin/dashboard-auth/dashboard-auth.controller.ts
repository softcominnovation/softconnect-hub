import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { JwtGuard } from '../../auth/jwt.guard';
import { DashboardAuthService } from './dashboard-auth.service';
import { DashboardLoginDto } from './dto/dashboard-login.dto';

interface AdminRequest extends FastifyRequest {
  admin: { sub: string };
}

@Controller('admin/auth/dashboard')
export class DashboardAuthController {
  constructor(private readonly dashboardAuthService: DashboardAuthService) {}

  @Post('login')
  login(@Body() dto: DashboardLoginDto, @Req() req: FastifyRequest) {
    return this.dashboardAuthService.login(dto.email, dto.password, req.ip);
  }

  @Get('me')
  @UseGuards(JwtGuard)
  getMe(@Req() req: AdminRequest) {
    return this.dashboardAuthService.getMe(req.admin.sub);
  }
}
