import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

interface FindAllOptions {
  page: number;
  limit: number;
  adminUserId?: string;
  from?: Date;
  to?: Date;
}

@Injectable()
export class AdminActivityService {
  constructor(private readonly prisma: PrismaService) {}

  record(
    adminUserId: string,
    action: string,
    detail?: string,
    ip?: string,
  ): void {
    void this.prisma.adminActivityLog
      .create({
        data: { adminUserId, action, detail: detail ?? null, ip: ip ?? null },
      })
      .catch(() => undefined);
  }

  async findAll(options: FindAllOptions) {
    const { page, limit, adminUserId, from, to } = options;
    const skip = (page - 1) * limit;

    const where = {
      ...(adminUserId ? { adminUserId } : {}),
      ...((from ?? to)
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.adminActivityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          adminUser: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.adminActivityLog.count({ where }),
    ]);

    return { data, total, page, limit };
  }
}
