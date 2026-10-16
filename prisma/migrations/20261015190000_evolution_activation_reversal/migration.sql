-- Additive administrative state. No existing configuration or data is rewritten.
CREATE TABLE "EvolutionSetupConfirmation" (
  "requirementsVersion" TEXT NOT NULL PRIMARY KEY,
  "databaseIdentity" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "actor" TEXT NOT NULL,
  "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "EvolutionChange" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "draft" JSONB NOT NULL,
  "snapshot" JSONB NOT NULL,
  "diagnostics" JSONB,
  "result" JSONB,
  "callback" JSONB,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "stage" TEXT NOT NULL DEFAULT 'queued',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "executionDeadline" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EvolutionChange_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EvolutionChange_productId_requestId_key" ON "EvolutionChange"("productId", "requestId");
CREATE INDEX "EvolutionChange_status_leaseExpiresAt_createdAt_idx" ON "EvolutionChange"("status", "leaseExpiresAt", "createdAt");
CREATE INDEX "EvolutionChange_productId_createdAt_idx" ON "EvolutionChange"("productId", "createdAt");
CREATE TABLE "EvolutionAdminEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actor" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "detail" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "EvolutionAdminEvent_createdAt_idx" ON "EvolutionAdminEvent"("createdAt");
ALTER TABLE "EvolutionChange" ADD CONSTRAINT "EvolutionChange_state_check"
  CHECK ("status" IN ('queued','running','action_required','ready','applied','failed','expired','cancelled') AND "revision" >= 0);
ALTER TABLE "EvolutionChange" ADD CONSTRAINT "EvolutionChange_action_check"
  CHECK ("action" IN ('configure_capacity','single_destination','restore_legacy','detach'));
ALTER TABLE "EvolutionChange" ADD CONSTRAINT "EvolutionChange_lease_check"
  CHECK (("leaseOwner" IS NULL) = ("leaseExpiresAt" IS NULL));
