import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  productId: string;
  instanceId?: string;
  endpoint: string;
  method: string;
  statusCode: number;
  latencyMs: number;
  origin?: string;
  ip: string;
  errorMsg?: string;
}

@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private buffer: AuditEntry[] = [];
  private flushTimer?: ReturnType<typeof setInterval>;
  private readonly flushIntervalMs: number;
  private readonly flushBatchSize: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.flushIntervalMs = this.config.get<number>(
      'AUDIT_FLUSH_INTERVAL_MS',
      1000,
    );
    this.flushBatchSize = this.config.get<number>(
      'AUDIT_FLUSH_BATCH_SIZE',
      100,
    );
  }

  onModuleInit() {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
  }

  onModuleDestroy() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    void this.flush();
  }

  log(entry: AuditEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length >= this.flushBatchSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const entries = this.buffer.splice(0, this.buffer.length);
    try {
      await this.prisma.auditLog.createMany({
        data: entries.map((e) => ({
          productId: e.productId,
          instanceId: e.instanceId ?? null,
          endpoint: e.endpoint,
          method: e.method,
          statusCode: e.statusCode,
          latencyMs: e.latencyMs,
          origin: e.origin ?? null,
          ip: e.ip,
          errorMsg: e.errorMsg ?? null,
        })),
      });
    } catch {
      // silently discard — audit must never block the app
    }
  }
}
