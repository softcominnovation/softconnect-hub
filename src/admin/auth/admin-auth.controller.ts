import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiExcludeController,
  ApiOperation,
  ApiResponse,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ApiTags,
} from '@nestjs/swagger';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminAuthService } from './admin-auth.service';

// Para reexpor esta seção no Swagger, remova @ApiExcludeController() e descomente @ApiTags abaixo
@ApiExcludeController()
// @ApiTags('Admin — Auth (machine)')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Autentica via ADMIN_SECRET e retorna JWT' })
  @ApiBody({ type: AdminLoginDto })
  @ApiResponse({ status: 200, description: 'JWT gerado com sucesso' })
  @ApiResponse({ status: 401, description: 'Secret inválido' })
  login(@Body() body: AdminLoginDto): { access_token: string } {
    return this.adminAuthService.login(body.secret);
  }
}
