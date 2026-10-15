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
