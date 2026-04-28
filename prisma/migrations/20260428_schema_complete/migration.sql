-- SoftConnect 2.0 — Schema Completo (migration única e consolidada)
-- Cria todas as tabelas, índices e relações com IF NOT EXISTS
-- Adiciona colunas faltantes com IF NOT EXISTS

-- CreateTable Product
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

-- CreateTable VpsServer
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

-- CreateTable Instance
CREATE TABLE IF NOT EXISTS "Instance" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "vpsId" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL,
    "instanceToken" TEXT,
    "hubToken" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Instance_pkey" PRIMARY KEY ("id")
);

-- CreateTable WebhookConfig
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

-- CreateTable AuditLog
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

-- CreateTable AdminUser
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

-- CreateTable AdminActivityLog
CREATE TABLE IF NOT EXISTS "AdminActivityLog" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable HealthCheck
CREATE TABLE IF NOT EXISTS "HealthCheck" (
    "id" TEXT NOT NULL,
    "vpsId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "responseMs" INTEGER NOT NULL,
    "errorMsg" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable BatchJob
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

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Product_slug_key" ON "Product"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "Product_apiKeyHash_key" ON "Product"("apiKeyHash");
CREATE UNIQUE INDEX IF NOT EXISTS "VpsServer_subdomain_key" ON "VpsServer"("subdomain");
CREATE UNIQUE INDEX IF NOT EXISTS "Instance_hubToken_key" ON "Instance"("hubToken");
CREATE UNIQUE INDEX IF NOT EXISTS "Instance_vpsId_instanceName_key" ON "Instance"("vpsId", "instanceName");
CREATE UNIQUE INDEX IF NOT EXISTS "Instance_productId_instanceName_key" ON "Instance"("productId", "instanceName");
CREATE UNIQUE INDEX IF NOT EXISTS "AdminUser_email_key" ON "AdminUser"("email");

-- Adiciona colunas faltantes se não existirem (para bancos parcialmente migrados)
ALTER TABLE IF EXISTS "VpsServer"
ADD COLUMN IF NOT EXISTS "monitorUrl" TEXT,
ADD COLUMN IF NOT EXISTS "monitorApiKey" TEXT;
