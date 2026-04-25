import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBearerAuth,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { JwtGuard } from '../../auth/jwt.guard';
import { DashboardAuthService } from './dashboard-auth.service';
import { DashboardLoginDto } from './dto/dashboard-login.dto';

interface AdminRequest extends FastifyRequest {
  admin: { sub: string };
}

@ApiTags('Admin — Auth (dashboard)')
@Controller('admin/auth/dashboard')
export class DashboardAuthController {
  constructor(private readonly dashboardAuthService: DashboardAuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Login com email/senha — retorna JWT dashboard' })
  @ApiResponse({ status: 201, description: 'JWT gerado' })
  @ApiResponse({ status: 401, description: 'Credenciais inválidas' })
  login(@Body() dto: DashboardLoginDto, @Req() req: FastifyRequest) {
    return this.dashboardAuthService.login(dto.email, dto.password, req.ip);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Retorna dados do usuário autenticado' })
  @ApiResponse({ status: 200, description: 'Dados do usuário' })
  getMe(@Req() req: AdminRequest) {
    return this.dashboardAuthService.getMe(req.admin.sub);
  }
}
