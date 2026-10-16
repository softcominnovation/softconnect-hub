import { Prisma } from '@prisma/client';

// Change only when the required writer protocol changes, not for each release.
export const EVOLUTION_REQUIREMENTS_VERSION = 'capacity-v1';

export async function databaseIdentity(tx: Prisma.TransactionClient) {
  const [row] = await tx.$queryRaw<Array<{ identity: string }>>`
    SELECT current_database() || ':' || oid::text AS identity
    FROM pg_database WHERE datname = current_database()`;
  return row.identity;
}

export async function writerConfirmation(tx: Prisma.TransactionClient) {
  const row = await tx.evolutionSetupConfirmation.findUnique({
    where: { requirementsVersion: EVOLUTION_REQUIREMENTS_VERSION },
  });
  return row && row.databaseIdentity === (await databaseIdentity(tx))
    ? row
    : null;
}
