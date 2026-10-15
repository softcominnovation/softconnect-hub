-- Run only after every API/worker writer is compatible. Not part of automatic deploy.
BEGIN;
LOCK TABLE "Product", "Instance", "ProductEvolution" IN SHARE ROW EXCLUSIVE MODE;
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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Instance" WHERE "providerInstanceId" IS NOT NULL
    GROUP BY "vpsProviderId", "providerInstanceId" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Ambiguous provider instance IDs: diagnose before consolidation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_id_vpsProviderId_fkey'
    AND conrelid = '"Product"'::regclass) THEN
    ALTER TABLE "Product" ADD CONSTRAINT "Product_id_vpsProviderId_fkey"
      FOREIGN KEY ("id", "vpsProviderId") REFERENCES "ProductEvolution" ("productId", "vpsProviderId")
      ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Instance_productId_vpsProviderId_fkey'
    AND conrelid = '"Instance"'::regclass) THEN
    ALTER TABLE "Instance" ADD CONSTRAINT "Instance_productId_vpsProviderId_fkey"
      FOREIGN KEY ("productId", "vpsProviderId") REFERENCES "ProductEvolution" ("productId", "vpsProviderId")
      ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;
  END IF;
END $$;
ALTER TABLE "Product" VALIDATE CONSTRAINT "Product_id_vpsProviderId_fkey";
ALTER TABLE "Instance" VALIDATE CONSTRAINT "Instance_productId_vpsProviderId_fkey";
CREATE UNIQUE INDEX IF NOT EXISTS "Instance_provider_remote_identity_key"
  ON "Instance" ("vpsProviderId", "providerInstanceId") WHERE "providerInstanceId" IS NOT NULL;
COMMIT;
