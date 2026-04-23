import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../auth/jwt.guard';
import { AdminActivityService } from './activity.service';

@Controller('admin/activity')
@UseGuards(JwtGuard)
export class AdminActivityController {
  constructor(private readonly activityService: AdminActivityService) {}

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('adminUserId') adminUserId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.activityService.findAll({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      adminUserId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }
}
