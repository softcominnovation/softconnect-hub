-- SoftConnect 2.0 — Migration Consolidada
-- Cria todas as tabelas, índices, relações e colunas com IF NOT EXISTS
-- Seguro para bancos novos e para bancos parcialmente migrados (preserva dados)

-- ─────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "adapterType" TEXT NOT NULL DEFAULT 'evolution',
    "origins" TEXT[],
    "hubRelay" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "vpsId" TEXT,
    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VpsServer" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "subdomain" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "providerUrl" TEXT NOT NULL,
    "providerApiKey" TEXT NOT NULL,
    "adapterType" TEXT NOT NULL DEFAULT 'evolution',
    "managerType" TEXT,
    "managerUrl" TEXT,
    "managerApiKey" TEXT,
    "monitorUrl" TEXT,
    "monitorApiKey" TEXT,
    "isHealthy" BOOLEAN NOT NULL DEFAULT true,
    "lastHealthAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VpsServer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Instance" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "vpsId" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL,
    "providerInstanceId" TEXT,
    "instanceToken" TEXT,
    "hubToken" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Instance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WebhookConfig" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "instanceId" TEXT,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "origin" TEXT,
    "ip" TEXT NOT NULL,
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdminUser" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'admin',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdminActivityLog" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminActivityLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "HealthCheck" (
    "id" TEXT NOT NULL,
    "vpsId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "responseMs" INTEGER NOT NULL,
    "errorMsg" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HealthCheck_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BatchJob" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "instanceId" TEXT,
    "totalMessages" INTEGER NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BatchJob_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────
-- Add missing columns on partially-migrated databases
-- ─────────────────────────────────────────

ALTER TABLE "VpsServer"
    ADD COLUMN IF NOT EXISTS "monitorUrl" TEXT,
    ADD COLUMN IF NOT EXISTS "monitorApiKey" TEXT;

ALTER TABLE "Instance"
    ADD COLUMN IF NOT EXISTS "providerInstanceId" TEXT;

-- ─────────────────────────────────────────
-- Unique indexes
-- ─────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "Product_slug_key"          ON "Product"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "Product_apiKeyHash_key"    ON "Product"("apiKeyHash");
CREATE UNIQUE INDEX IF NOT EXISTS "VpsServer_subdomain_key"   ON "VpsServer"("subdomain");
CREATE UNIQUE INDEX IF NOT EXISTS "Instance_hubToken_key"     ON "Instance"("hubToken");
CREATE UNIQUE INDEX IF NOT EXISTS "Instance_vpsId_instanceName_key"     ON "Instance"("vpsId", "instanceName");
CREATE UNIQUE INDEX IF NOT EXISTS "Instance_productId_instanceName_key" ON "Instance"("productId", "instanceName");
CREATE UNIQUE INDEX IF NOT EXISTS "AdminUser_email_key"       ON "AdminUser"("email");

-- ─────────────────────────────────────────
-- Foreign keys (only add if the constraint does not already exist)
-- ─────────────────────────────────────────

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'Product_vpsId_fkey'
    ) THEN
        ALTER TABLE "Product"
            ADD CONSTRAINT "Product_vpsId_fkey"
            FOREIGN KEY ("vpsId") REFERENCES "VpsServer"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'Instance_productId_fkey'
    ) THEN
        ALTER TABLE "Instance"
            ADD CONSTRAINT "Instance_productId_fkey"
            FOREIGN KEY ("productId") REFERENCES "Product"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'Instance_vpsId_fkey'
    ) THEN
        ALTER TABLE "Instance"
            ADD CONSTRAINT "Instance_vpsId_fkey"
            FOREIGN KEY ("vpsId") REFERENCES "VpsServer"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'WebhookConfig_productId_fkey'
    ) THEN
        ALTER TABLE "WebhookConfig"
            ADD CONSTRAINT "WebhookConfig_productId_fkey"
            FOREIGN KEY ("productId") REFERENCES "Product"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'AuditLog_productId_fkey'
    ) THEN
        ALTER TABLE "AuditLog"
            ADD CONSTRAINT "AuditLog_productId_fkey"
            FOREIGN KEY ("productId") REFERENCES "Product"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'AuditLog_instanceId_fkey'
    ) THEN
        ALTER TABLE "AuditLog"
            ADD CONSTRAINT "AuditLog_instanceId_fkey"
            FOREIGN KEY ("instanceId") REFERENCES "Instance"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'AdminActivityLog_adminUserId_fkey'
    ) THEN
        ALTER TABLE "AdminActivityLog"
            ADD CONSTRAINT "AdminActivityLog_adminUserId_fkey"
            FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'HealthCheck_vpsId_fkey'
    ) THEN
        ALTER TABLE "HealthCheck"
            ADD CONSTRAINT "HealthCheck_vpsId_fkey"
            FOREIGN KEY ("vpsId") REFERENCES "VpsServer"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'BatchJob_productId_fkey'
    ) THEN
        ALTER TABLE "BatchJob"
            ADD CONSTRAINT "BatchJob_productId_fkey"
            FOREIGN KEY ("productId") REFERENCES "Product"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
