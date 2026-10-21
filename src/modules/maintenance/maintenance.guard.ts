import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { canonicalEvolutionEndpoint } from '../../prisma/evolution-identity';
import { lockProvider } from '../provisioning/evolution-locks';
import { LEASE_MS, manualLeases, PENDING_ACTIONS } from './maintenance.config';

@Injectable()
export class MaintenanceGuard {
  private readonly logger = new Logger(MaintenanceGuard.name);
  constructor(private readonly db: PrismaService) {}

  async run<T>(url: string, name: string, run: () => Promise<T>): Promise<T> {
    const providers = await this.db.vpsProvider.findMany({
      where: {
        OR: [
          { providerUrl: url },
          { canonicalEndpoint: canonicalEvolutionEndpoint(url) ?? 'invalid' },
        ],
        maintenancePolicy: { isNot: null },
      },
      select: { id: true },
    });
    if (!providers.length) return run();
    const owner = randomUUID();
    const acquired: string[] = [];
    const change = async (id: string, release = false) =>
      this.db.$transaction(async (tx) => {
        await lockProvider(tx, id);
        const policy = await tx.providerMaintenancePolicy.findUnique({
          where: { providerId: id },
        });
        if (!policy) return;
        const [{ now }] = await tx.$queryRaw<
          Array<{ now: Date }>
        >`SELECT clock_timestamp() AS now`;
        const leases = manualLeases(policy.manualLeases, now);
        if (release) delete leases[owner];
        else {
          if (
            await tx.instanceMaintenanceAction.findFirst({
              where: {
                providerId: id,
                instanceName: name,
                state: { in: PENDING_ACTIONS },
              },
            })
          )
            throw new ConflictException(
              'Manutenção da instância aguardando confirmação; tente após a conclusão.',
            );
          leases[owner] = now.getTime() + LEASE_MS;
          await tx.instanceMaintenanceObservation.updateMany({
            where: { providerId: id, instanceName: name },
            data: {
              connectingObservedSince: null,
              samples: 0,
              reason: 'manual_operation',
            },
          });
        }
        await tx.providerMaintenancePolicy.update({
          where: { providerId: id },
          data: {
            manualLeases: leases,
            ...(!release ? { generation: randomUUID() } : {}),
          },
        });
      });
    let timer: NodeJS.Timeout | undefined;
    let renewing: Promise<unknown> | undefined;
    try {
      for (const p of providers) {
        await change(p.id);
        acquired.push(p.id);
      }
      timer = setInterval(() => {
        if (!renewing)
          renewing = Promise.all(acquired.map((id) => change(id)))
            .catch(() =>
              this.logger.error('event=maintenance_manual_lease_error'),
            )
            .finally(() => {
              renewing = undefined;
            });
      }, 30000);
      timer.unref();
      return await run();
    } finally {
      clearInterval(timer);
      await renewing;
      await Promise.all(
        acquired.map((id) =>
          change(id, true).catch(() =>
            this.logger.error('event=maintenance_manual_release_error'),
          ),
        ),
      );
    }
  }
}
