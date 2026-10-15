import { BadGatewayException } from '@nestjs/common';
import type { InstanceDto } from '../../providers/whatsapp-provider.interface';

export interface RemoteSession {
  instanceName: string;
  providerInstanceId: string | null;
  status: string | null;
}

export interface OccupiedSession {
  id: string;
  productId: string;
  instanceName: string;
  providerInstanceId: string | null;
}

export function normalizeInventory(rows: InstanceDto[]): RemoteSession[] {
  const names = new Set<string>();
  const ids = new Set<string>();
  return rows.map((row) => {
    const name = row.instanceName;
    const id = row.id ?? row.instanceId ?? null;
    if (
      typeof name !== 'string' ||
      !name ||
      (id !== null && (typeof id !== 'string' || !id)) ||
      names.has(name) ||
      (id !== null && ids.has(id))
    ) {
      throw new BadGatewayException('Inventário incompleto ou ambíguo');
    }
    names.add(name);
    if (id) ids.add(id);
    return {
      instanceName: name,
      providerInstanceId: id,
      status: typeof row.status === 'string' ? row.status : null,
    };
  });
}

export function sameSession(
  a: RemoteSession | OccupiedSession,
  b: RemoteSession | OccupiedSession,
): boolean {
  return (
    a.instanceName === b.instanceName &&
    (!a.providerInstanceId ||
      !b.providerInstanceId ||
      a.providerInstanceId === b.providerInstanceId)
  );
}

export function occupancy(
  remote: RemoteSession[],
  instances: OccupiedSession[],
  reservations: OccupiedSession[],
  absentInstanceIds: Set<string> = new Set(),
) {
  const groups: Array<RemoteSession & { productId?: string }> = [];
  let ambiguous = false;
  const add = (item: RemoteSession & { productId?: string }) => {
    const existing = groups.find(
      (other) =>
        other.instanceName === item.instanceName ||
        (!!item.providerInstanceId &&
          other.providerInstanceId === item.providerInstanceId),
    );
    if (!existing) groups.push({ ...item });
    else if (
      !sameSession(existing, item) ||
      (existing.productId &&
        item.productId &&
        existing.productId !== item.productId)
    ) {
      ambiguous = true;
    } else {
      existing.providerInstanceId ??= item.providerInstanceId;
      existing.productId ??= item.productId;
    }
  };
  for (const row of remote) add(row);
  for (const row of instances) {
    if (!absentInstanceIds.has(row.id)) add({ ...row, status: null });
  }
  for (const row of reservations) add({ ...row, status: null });
  const byProduct: Record<string, number> = {};
  for (const item of groups) {
    if (item.productId)
      byProduct[item.productId] = (byProduct[item.productId] ?? 0) + 1;
  }
  return { effective: groups.length, ambiguous, byProduct };
}

export function remoteToken(row: InstanceDto): string | undefined {
  const nested = row.instance as Record<string, unknown> | undefined;
  const token = row.token ?? nested?.token;
  return typeof token === 'string' ? token : undefined;
}
