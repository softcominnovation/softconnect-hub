import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AdapterResolverService } from '../../providers/adapter-resolver.service';
import { EvolutionInventoryService } from './evolution-inventory.service';
import { EvolutionProvisioningService } from './evolution-provisioning.service';
import { EvolutionRecoveryService } from './evolution-recovery.service';

describe('Administrative preparation scheduling', () => {
  function service(mode = 'api') {
    return new EvolutionRecoveryService(
      {} as PrismaService,
      {} as EvolutionProvisioningService,
      {} as EvolutionInventoryService,
      {} as AdapterResolverService,
      new ConfigService({
        RUNTIME_MODE: mode,
        EVOLUTION_RECOVERY_INTERVAL_MS: 100,
      }),
    );
  }
  afterEach(() => {
    jest.useRealTimers();
  });
  it('schedules recovery while administration is pending, without overlapping administration on a replica', async () => {
    jest.useFakeTimers();
    const recovery = service();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = jest.fn(() => gate);
    recovery.registerAdministrativePreparation(run);
    const scan = jest.spyOn(recovery, 'scan').mockResolvedValue(undefined);
    recovery.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(500);
    expect(scan).toHaveBeenCalledTimes(5);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await jest.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(2);
    recovery.onModuleDestroy();
  });
  it('schedules administration even if a creation recovery is still pending', async () => {
    jest.useFakeTimers();
    const recovery = service();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    jest.spyOn(recovery, 'scan').mockReturnValue(gate);
    const run = jest.fn().mockResolvedValue(undefined);
    recovery.registerAdministrativePreparation(run);
    recovery.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    recovery.onModuleDestroy();
  });
  it('does not start administration on worker-batch', async () => {
    jest.useFakeTimers();
    const recovery = service('worker-batch');
    const run = jest.fn().mockResolvedValue(undefined);
    recovery.registerAdministrativePreparation(run);
    recovery.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(500);
    expect(run).not.toHaveBeenCalled();
    recovery.onModuleDestroy();
  });
});
