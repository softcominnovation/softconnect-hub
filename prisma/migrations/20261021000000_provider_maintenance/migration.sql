-- CreateTable
CREATE TABLE "ProviderMaintenancePolicy" (
    "providerId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "action" TEXT NOT NULL DEFAULT 'disconnect',
    "mode" TEXT NOT NULL DEFAULT 'observe',
    "connectingMaxAgeMinutes" INTEGER,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "actor" TEXT,
    "generation" TEXT NOT NULL,
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "fencingToken" INTEGER NOT NULL DEFAULT 0,
    "manualLeases" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderMaintenancePolicy_pkey" PRIMARY KEY ("providerId")
);

-- CreateTable
CREATE TABLE "InstanceMaintenanceObservation" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "remoteStatus" TEXT NOT NULL,
    "generation" TEXT NOT NULL,
    "episode" TEXT NOT NULL,
    "connectingObservedSince" TIMESTAMP(3),
    "lastObservedAt" TIMESTAMP(3) NOT NULL,
    "samples" INTEGER NOT NULL DEFAULT 1,
    "reason" TEXT,

    CONSTRAINT "InstanceMaintenanceObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstanceMaintenanceAction" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "providerRevision" INTEGER NOT NULL,
    "policyRevision" INTEGER NOT NULL,
    "episode" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextCheckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstanceMaintenanceAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderMaintenancePolicy_enabled_leaseUntil_idx" ON "ProviderMaintenancePolicy"("enabled", "leaseUntil");

-- CreateIndex
CREATE INDEX "InstanceMaintenanceObservation_providerId_connectingObserve_idx" ON "InstanceMaintenanceObservation"("providerId", "connectingObservedSince");

-- CreateIndex
CREATE UNIQUE INDEX "InstanceMaintenanceObservation_providerId_instanceId_key" ON "InstanceMaintenanceObservation"("providerId", "instanceId");

-- CreateIndex
CREATE INDEX "InstanceMaintenanceAction_providerId_createdAt_id_idx" ON "InstanceMaintenanceAction"("providerId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "InstanceMaintenanceAction_state_nextCheckAt_idx" ON "InstanceMaintenanceAction"("state", "nextCheckAt");

-- CreateIndex
CREATE UNIQUE INDEX "InstanceMaintenanceAction_providerId_instanceId_episode_act_key" ON "InstanceMaintenanceAction"("providerId", "instanceId", "episode", "action");

-- AddForeignKey
ALTER TABLE "ProviderMaintenancePolicy" ADD CONSTRAINT "ProviderMaintenancePolicy_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "VpsProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstanceMaintenanceObservation" ADD CONSTRAINT "InstanceMaintenanceObservation_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "VpsProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstanceMaintenanceObservation" ADD CONSTRAINT "InstanceMaintenanceObservation_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstanceMaintenanceAction" ADD CONSTRAINT "InstanceMaintenanceAction_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "VpsProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

