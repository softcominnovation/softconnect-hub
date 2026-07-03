import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export interface LogsQuery {
  productId?: string;
  instanceId?: string;
  statusCode?: number;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedLogs {
  data: {
    id: string;
    productId: string;
    instanceId: string | null;
    endpoint: string;
    method: string;
    statusCode: number;
    latencyMs: number;
    origin: string | null;
    ip: string;
    errorMsg: string | null;
    createdAt: Date;
  }[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class LogsService {
  constructor(private readonly prisma: PrismaService) {}

  async findLogs(query: LogsQuery): Promise<PaginatedLogs> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit =
      query.limit && query.limit > 0 && query.limit <= 200 ? query.limit : 50;
    const skip = (page - 1) * limit;

    const where = {
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.instanceId ? { instanceId: query.instanceId } : {}),
      ...(query.statusCode ? { statusCode: query.statusCode } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
