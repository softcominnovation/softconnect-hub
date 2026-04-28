import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Headers,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AdminUsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtGuard } from '../../auth/jwt.guard';

interface AdminRequest extends FastifyRequest {
  admin: { sub: string; type?: string };
}

@ApiTags('Admin — Users')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly usersService: AdminUsersService) {}

  @Post('bootstrap')
  @ApiOperation({
    summary: 'Cria o primeiro usuário admin (requer ALLOW_BOOTSTRAP=true)',
  })
  @ApiHeader({
    name: 'x-admin-secret',
    description: 'Secret de bootstrap (variável ADMIN_SECRET)',
    required: true,
  })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({ status: 201, description: 'Usuário bootstrap criado' })
  @ApiResponse({
    status: 403,
    description: 'Bootstrap desativado ou secret inválido',
  })
  @ApiResponse({ status: 409, description: 'Já existe um usuário admin' })
  bootstrap(
    @Body() dto: CreateUserDto,
    @Headers('x-admin-secret') secret: string | undefined,
    @Req() req: AdminRequest,
  ) {
    return this.usersService.bootstrap(dto, secret, req.ip);
  }

  @ApiBearerAuth()
  @UseGuards(JwtGuard)
  @Post()
  @ApiOperation({ summary: 'Cria um novo usuário admin' })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({ status: 201, description: 'Usuário criado' })
  create(@Body() dto: CreateUserDto, @Req() req: AdminRequest) {
    const actorId = req.admin?.sub !== 'admin' ? req.admin?.sub : undefined;
    return this.usersService.create(dto, actorId, req.ip);
  }

  @ApiBearerAuth()
  @UseGuards(JwtGuard)
  @Get()
  @ApiOperation({ summary: 'Lista todos os usuários admin' })
  @ApiResponse({ status: 200, description: 'Lista de usuários' })
  findAll() {
    return this.usersService.findAll();
  }

  @ApiBearerAuth()
  @UseGuards(JwtGuard)
  @Put(':id')
  @ApiOperation({ summary: 'Atualiza um usuário admin' })
  @ApiParam({
    name: 'id',
    description: 'UUID do usuário',
    example: 'uuid-do-usuario',
  })
  @ApiBody({ type: UpdateUserDto })
  @ApiResponse({ status: 200, description: 'Usuário atualizado' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: AdminRequest,
  ) {
    const actorId = req.admin?.sub !== 'admin' ? req.admin?.sub : undefined;
    return this.usersService.update(id, dto, actorId, req.ip);
  }

  @ApiBearerAuth()
  @UseGuards(JwtGuard)
  @Delete(':id')
  @ApiOperation({ summary: 'Desativa um usuário admin' })
  @ApiParam({
    name: 'id',
    description: 'UUID do usuário',
    example: 'uuid-do-usuario',
  })
  @ApiResponse({ status: 200, description: 'Usuário desativado' })
  deactivate(@Param('id') id: string, @Req() req: AdminRequest) {
    const actorId = req.admin?.sub !== 'admin' ? req.admin?.sub : undefined;
    return this.usersService.deactivate(id, actorId, req.ip);
  }
}
