import { randomUUID } from 'node:crypto';
import type { InstanceMaintenanceObservation } from '@prisma/client';

export interface MaintenanceRemote {
  id: string;
  name: string;
  status: string;
}

export function parseMaintenanceInventory(value: unknown): MaintenanceRemote[] {
  if (!Array.isArray(value) || value.length > 10000)
    throw new Error('inventory_invalid');
  const names = new Set<string>(),
    ids = new Set<string>();
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object')
      throw new Error('inventory_invalid');
    const row = entry as Record<string, unknown>;
    const nested =
      row.instance && typeof row.instance === 'object'
        ? (row.instance as Record<string, unknown>)
        : {};
    const id = row.id ?? row.instanceId ?? nested.instanceId;
    const name = row.name ?? row.instanceName ?? nested.instanceName;
    const status =
      row.connectionStatus ??
      row.status ??
      nested.connectionStatus ??
      nested.status;
    if (
      typeof id !== 'string' ||
      !id ||
      typeof name !== 'string' ||
      !name ||
      name === '.' ||
      name === '..' ||
      typeof status !== 'string' ||
      !status ||
      ids.has(id) ||
      names.has(name)
    )
      throw new Error('inventory_invalid');
    ids.add(id);
    names.add(name);
    return { id, name, status };
  });
}

export function observeConnecting(
  old: InstanceMaintenanceObservation | null,
  remote: MaintenanceRemote,
  generation: string,
  now: Date,
  gap: number,
) {
  const continuous =
    old?.connectingObservedSince &&
    old.remoteStatus === 'connecting' &&
    remote.status === 'connecting' &&
    old.remoteId === remote.id &&
    old.instanceName === remote.name &&
    old.generation === generation &&
    now.getTime() >= old.lastObservedAt.getTime() &&
    now.getTime() - old.lastObservedAt.getTime() <= gap;
  return {
    remoteId: remote.id,
    instanceName: remote.name,
    remoteStatus: remote.status,
    generation,
    connectingObservedSince:
      remote.status === 'connecting'
        ? continuous
          ? old.connectingObservedSince
          : now
        : null,
    lastObservedAt: now,
    samples: continuous ? old.samples + 1 : 1,
    episode: continuous ? old.episode : randomUUID(),
    reason: remote.status === 'connecting' ? null : 'not_connecting',
  };
}

export function eligibleObservation(
  row: InstanceMaintenanceObservation,
  now: Date,
  age: number,
  gap: number,
) {
  return (
    row.remoteStatus === 'connecting' &&
    row.samples >= 2 &&
    !!row.connectingObservedSince &&
    now.getTime() >= row.lastObservedAt.getTime() &&
    now.getTime() - row.lastObservedAt.getTime() <= gap &&
    now.getTime() - row.connectingObservedSince.getTime() >= age * 60000
  );
}
