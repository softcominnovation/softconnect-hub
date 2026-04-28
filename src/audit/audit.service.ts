import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
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
  private readonly logger = new Logger(AuditService.name);
  private buffer: AuditEntry[] = [];
  private flushTimer?: ReturnType<typeof setInterval>;
  private readonly flushIntervalMs: number;
  private readonly flushBatchSize: number;
  private readonly maxBufferSize: number;

  // Controle de estado — evita logar alerta repetidamente por episódio
  private isUnderPressure = false;

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
    this.maxBufferSize = this.config.get<number>('AUDIT_BUFFER_MAX_SIZE', 1000);
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
    // ── BACKPRESSURE — load shedding ──────────────────────────────
    if (this.buffer.length >= this.maxBufferSize) {
      if (!this.isUnderPressure) {
        this.isUnderPressure = true;
        this.logger.warn(
          `Audit buffer cheio (${this.maxBufferSize} registros). ` +
            `Postgres pode estar lento ou indisponível. ` +
            `Novos registros de audit serão descartados até o buffer esvaziar.`,
        );
      }
      return;
    }

    if (this.isUnderPressure) {
      this.isUnderPressure = false;
      this.logger.log(
        'Audit buffer normalizado — registros voltando a ser aceitos.',
      );
    }
    // ─────────────────────────────────────────────────────────────

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
    } catch (error) {
      // Registros deste lote são descartados — audit nunca deve bloquear a app
      this.logger.error(
        `Falha ao persistir ${entries.length} registros de audit: ${String(error instanceof Error ? error.message : error)}`,
      );
    }
  }
}
