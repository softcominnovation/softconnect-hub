BEGIN;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "allocationMode" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN     "allocationRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "capacityFirstAllocationAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "VpsProvider" ADD COLUMN     "acceptingNewInstances" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "callbackReadiness" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "callbackTokenEncrypted" TEXT,
ADD COLUMN     "canonicalEndpoint" TEXT,
ADD COLUMN     "configurationRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "identityStatus" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "inventoryObservedAt" TIMESTAMP(3),
ADD COLUMN     "inventoryRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "inventoryStatus" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN     "maxInstances" INTEGER,
ADD COLUMN     "occupancyRevision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ProductEvolution" (
    "productId" TEXT NOT NULL,
    "vpsProviderId" TEXT NOT NULL,
    "allocationPriority" INTEGER NOT NULL DEFAULT 0,
    "acceptingNewInstances" BOOLEAN NOT NULL DEFAULT false,
    "configurationRevision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductEvolution_pkey" PRIMARY KEY ("productId","vpsProviderId")
);

-- CreateTable
CREATE TABLE "InstanceProvisioning" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "vpsProviderId" TEXT NOT NULL,
    "linkProductId" TEXT,
    "linkVpsProviderId" TEXT,
    "instanceName" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'reserved',
    "instanceId" TEXT,
    "providerInstanceId" TEXT,
    "encryptedRequest" TEXT,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstanceProvisioning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvolutionReconciliation" (
    "id" TEXT NOT NULL,
    "vpsProviderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "observedOccupancyRevision" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "collectionStartedAt" TIMESTAMP(3),
    "collectionFinishedAt" TIMESTAMP(3),
    "result" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvolutionReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvolutionInventoryEntry" (
    "vpsProviderId" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL,
    "providerInstanceId" TEXT,
    "status" TEXT,
    "inventoryRevision" INTEGER NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvolutionInventoryEntry_pkey" PRIMARY KEY ("vpsProviderId","identityKey")
);

-- CreateTable
CREATE TABLE "PendingRelayEvent" (
    "id" TEXT NOT NULL,
    "vpsProviderId" TEXT,
    "instanceId" TEXT,
    "instanceName" TEXT,
    "providerInstanceId" TEXT,
    "encryptedPayload" TEXT NOT NULL,
    "originEvidence" JSONB,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "errorCode" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "PendingRelayEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductEvolution_vpsProviderId_idx" ON "ProductEvolution"("vpsProviderId");

-- CreateIndex
CREATE INDEX "ProductEvolution_productId_allocationPriority_idx" ON "ProductEvolution"("productId", "allocationPriority");

-- CreateIndex
CREATE INDEX "InstanceProvisioning_state_leaseExpiresAt_idx" ON "InstanceProvisioning"("state", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "InstanceProvisioning_instanceId_idx" ON "InstanceProvisioning"("instanceId");

-- CreateIndex
CREATE INDEX "EvolutionReconciliation_status_leaseExpiresAt_idx" ON "EvolutionReconciliation"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "EvolutionReconciliation_vpsProviderId_createdAt_idx" ON "EvolutionReconciliation"("vpsProviderId", "createdAt");

-- CreateIndex
CREATE INDEX "EvolutionInventoryEntry_vpsProviderId_instanceName_idx" ON "EvolutionInventoryEntry"("vpsProviderId", "instanceName");

-- CreateIndex
CREATE INDEX "PendingRelayEvent_state_receivedAt_idx" ON "PendingRelayEvent"("state", "receivedAt");

-- CreateIndex
CREATE INDEX "PendingRelayEvent_vpsProviderId_instanceName_idx" ON "PendingRelayEvent"("vpsProviderId", "instanceName");

-- CreateIndex
CREATE INDEX "VpsProvider_canonicalEndpoint_idx" ON "VpsProvider"("canonicalEndpoint");

-- AddForeignKey
-- Existing-writer constraints are consolidated explicitly after rollout.

-- AddForeignKey
ALTER TABLE "ProductEvolution" ADD CONSTRAINT "ProductEvolution_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProductEvolution" ADD CONSTRAINT "ProductEvolution_vpsProviderId_fkey" FOREIGN KEY ("vpsProviderId") REFERENCES "VpsProvider"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
-- Existing-writer constraints are consolidated explicitly after rollout.

-- AddForeignKey
ALTER TABLE "InstanceProvisioning" ADD CONSTRAINT "InstanceProvisioning_linkProductId_linkVpsProviderId_fkey" FOREIGN KEY ("linkProductId", "linkVpsProviderId") REFERENCES "ProductEvolution"("productId", "vpsProviderId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "InstanceProvisioning" ADD CONSTRAINT "InstanceProvisioning_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "InstanceProvisioning" ADD CONSTRAINT "InstanceProvisioning_vpsProviderId_fkey" FOREIGN KEY ("vpsProviderId") REFERENCES "VpsProvider"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "InstanceProvisioning" ADD CONSTRAINT "InstanceProvisioning_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "EvolutionReconciliation" ADD CONSTRAINT "EvolutionReconciliation_vpsProviderId_fkey" FOREIGN KEY ("vpsProviderId") REFERENCES "VpsProvider"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "EvolutionInventoryEntry" ADD CONSTRAINT "EvolutionInventoryEntry_vpsProviderId_fkey" FOREIGN KEY ("vpsProviderId") REFERENCES "VpsProvider"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PendingRelayEvent" ADD CONSTRAINT "PendingRelayEvent_vpsProviderId_fkey" FOREIGN KEY ("vpsProviderId") REFERENCES "VpsProvider"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PendingRelayEvent" ADD CONSTRAINT "PendingRelayEvent_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE SET NULL ON UPDATE RESTRICT;


ALTER TABLE "Product" ADD CONSTRAINT "Product_allocation_policy_check"
  CHECK ("allocationMode" IN ('legacy', 'capacity') AND "allocationRevision" >= 0);
ALTER TABLE "VpsProvider" ADD CONSTRAINT "VpsProvider_capacity_check"
  CHECK (("maxInstances" IS NULL OR "maxInstances" > 0)
    AND "configurationRevision" >= 0 AND "inventoryRevision" >= 0 AND "occupancyRevision" >= 0);
ALTER TABLE "ProductEvolution" ADD CONSTRAINT "ProductEvolution_policy_check"
  CHECK ("allocationPriority" >= 0 AND "configurationRevision" >= 0);
ALTER TABLE "InstanceProvisioning" ADD CONSTRAINT "InstanceProvisioning_state_check"
  CHECK ("state" IN ('reserved', 'creating', 'uncertain', 'cleanup_pending', 'committed', 'released', 'failed')
    AND "revision" >= 0);
ALTER TABLE "InstanceProvisioning" ADD CONSTRAINT "InstanceProvisioning_active_link_check"
  CHECK (
    ("linkProductId" IS NULL AND "linkVpsProviderId" IS NULL AND "state" IN ('committed', 'released', 'failed'))
    OR ("state" IN ('reserved', 'creating', 'uncertain', 'cleanup_pending')
      AND "linkProductId" IS NOT NULL AND "linkVpsProviderId" IS NOT NULL
      AND "linkProductId" = "productId" AND "linkVpsProviderId" = "vpsProviderId")
  );
CREATE UNIQUE INDEX "InstanceProvisioning_open_product_name_key"
  ON "InstanceProvisioning" ("productId", "instanceName")
  WHERE "state" IN ('reserved', 'creating', 'uncertain', 'cleanup_pending');
CREATE UNIQUE INDEX "InstanceProvisioning_open_provider_name_key"
  ON "InstanceProvisioning" ("vpsProviderId", "instanceName")
  WHERE "state" IN ('reserved', 'creating', 'uncertain', 'cleanup_pending');
ALTER TABLE "EvolutionReconciliation" ADD CONSTRAINT "EvolutionReconciliation_state_check"
  CHECK ("status" IN ('pending', 'running', 'completed', 'failed')
    AND "revision" >= 0 AND "observedOccupancyRevision" >= 0);
CREATE UNIQUE INDEX "EvolutionReconciliation_active_provider_key"
  ON "EvolutionReconciliation" ("vpsProviderId") WHERE "status" IN ('pending', 'running');

-- Idempotent: never overwrite an explicit priority or admission decision.
WITH pairs AS (
  SELECT p."id" AS "productId", p."vpsProviderId", true AS "isDefault"
  FROM "Product" p WHERE p."vpsProviderId" IS NOT NULL
  UNION ALL
  SELECT i."productId", i."vpsProviderId", false AS "isDefault"
  FROM "Instance" i
), grouped AS (
  SELECT "productId", "vpsProviderId", bool_or("isDefault") AS "isDefault"
  FROM pairs GROUP BY "productId", "vpsProviderId"
), ranked AS (
  SELECT g.*, p."allocationMode", row_number() OVER (
    PARTITION BY g."productId" ORDER BY g."isDefault" DESC, g."vpsProviderId"
  )::integer AS priority
  FROM grouped g
  JOIN "Product" p ON p."id" = g."productId"
  JOIN "VpsProvider" v ON v."id" = g."vpsProviderId"
)
INSERT INTO "ProductEvolution" (
  "productId", "vpsProviderId", "allocationPriority",
  "acceptingNewInstances", "configurationRevision", "createdAt", "updatedAt"
)
SELECT "productId", "vpsProviderId", CASE WHEN "isDefault" THEN 0 ELSE priority END,
       ("isDefault" AND "allocationMode" = 'legacy'), 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM ranked
ON CONFLICT ("productId", "vpsProviderId") DO NOTHING;

COMMIT;
