import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../../auth/jwt.guard';
import { CreateVpsDto } from './dto/create-vps.dto';
import { UpdateVpsDto } from './dto/update-vps.dto';
import { VpsService } from './vps.service';

@Controller('admin/vps')
@UseGuards(JwtGuard)
export class VpsController {
  constructor(private readonly vpsService: VpsService) {}

  @Post()
  create(@Body() dto: CreateVpsDto) {
    return this.vpsService.create(dto);
  }

  @Get()
  findAll() {
    return this.vpsService.findAll();
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateVpsDto) {
    return this.vpsService.update(id, dto);
  }

  @Delete(':id')
  deactivate(@Param('id') id: string) {
    return this.vpsService.deactivate(id);
  }
}
