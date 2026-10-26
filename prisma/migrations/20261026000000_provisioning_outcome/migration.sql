-- Additive evidence only. Historical uncertainty is deliberately not reclassified.
ALTER TABLE "InstanceProvisioning" ADD COLUMN "outcomeEvidence" JSONB;
