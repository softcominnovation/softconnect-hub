import { Controller, Post, Get, Put, Delete, Body, Param, Headers, UseGuards, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AdminUsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtGuard } from '../../auth/jwt.guard';

interface AdminRequest extends FastifyRequest {
  admin: { sub: string; type?: string };
}

@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly usersService: AdminUsersService) {}

  @Post('bootstrap')
  bootstrap(
    @Body() dto: CreateUserDto,
    @Headers('x-admin-secret') secret: string | undefined,
    @Req() req: AdminRequest,
  ) {
    return this.usersService.bootstrap(dto, secret, req.ip);
  }

  @UseGuards(JwtGuard)
  @Post()
  create(@Body() dto: CreateUserDto, @Req() req: AdminRequest) {
    const actorId = req.admin?.sub !== 'admin' ? req.admin?.sub : undefined;
    return this.usersService.create(dto, actorId, req.ip);
  }

  @UseGuards(JwtGuard)
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @UseGuards(JwtGuard)
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Req() req: AdminRequest) {
    const actorId = req.admin?.sub !== 'admin' ? req.admin?.sub : undefined;
    return this.usersService.update(id, dto, actorId, req.ip);
  }

  @UseGuards(JwtGuard)
  @Delete(':id')
  deactivate(@Param('id') id: string, @Req() req: AdminRequest) {
    const actorId = req.admin?.sub !== 'admin' ? req.admin?.sub : undefined;
    return this.usersService.deactivate(id, actorId, req.ip);
  }
}
