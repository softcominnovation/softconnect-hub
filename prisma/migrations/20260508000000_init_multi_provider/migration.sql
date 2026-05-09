-- SoftConnect 2.0 — Migration única consolidada com suporte a multi-provider por VPS
-- Criada em: 2026-05-08
-- Inclui: todas as tabelas, índices únicos, relações e novos modelos VpsProvider

-- CreateTable Product
CREATE TABLE "Product" (
    "id"                  TEXT NOT NULL,
    "name"                TEXT NOT NULL,
    "slug"                TEXT NOT NULL,
    "apiKeyHash"          TEXT NOT NULL,
    "adapterType"         TEXT NOT NULL DEFAULT 'evolution',
    "origins"             TEXT[],
    "hubRelay"            BOOLEAN NOT NULL DEFAULT false,
    "batchWebhookEnabled" BOOLEAN NOT NULL DEFAULT false,
    "batchWebhookUrl"     TEXT,
    "isActive"            BOOLEAN NOT NULL DEFAULT true,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,
    "vpsProviderId"       TEXT,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable VpsServer
CREATE TABLE "VpsServer" (
    "id"            TEXT NOT NULL,
    "label"         TEXT NOT NULL,
    "subdomain"     TEXT NOT NULL,
    "ip"            TEXT NOT NULL,
    "managerType"   TEXT,
    "managerUrl"    TEXT,
    "managerApiKey" TEXT,
    "monitorUrl"    TEXT,
    "monitorApiKey" TEXT,
    "notes"         TEXT,
    "isActive"      BOOLEAN NOT NULL DEFAULT true,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VpsServer_pkey" PRIMARY KEY ("id")
);

-- CreateTable VpsProvider
CREATE TABLE "VpsProvider" (
    "id"             TEXT NOT NULL,
    "vpsId"          TEXT NOT NULL,
    "label"          TEXT NOT NULL,
    "providerUrl"    TEXT NOT NULL,
    "providerApiKey" TEXT NOT NULL,
    "adapterType"    TEXT NOT NULL DEFAULT 'evolution',
    "isHealthy"      BOOLEAN NOT NULL DEFAULT true,
    "lastHealthAt"   TIMESTAMP(3),
    "isActive"       BOOLEAN NOT NULL DEFAULT true,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VpsProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable Instance
CREATE TABLE "Instance" (
    "id"                 TEXT NOT NULL,
    "productId"          TEXT NOT NULL,
    "vpsProviderId"      TEXT NOT NULL,
    "instanceName"       TEXT NOT NULL,
    "providerInstanceId" TEXT,
    "instanceToken"      TEXT,
    "hubToken"           TEXT NOT NULL,
    "phoneNumber"        TEXT,
    "status"             TEXT NOT NULL DEFAULT 'disconnected',
    "isActive"           BOOLEAN NOT NULL DEFAULT true,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Instance_pkey" PRIMARY KEY ("id")
);

-- CreateTable WebhookConfig
CREATE TABLE "WebhookConfig" (
    "id"        TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "url"       TEXT NOT NULL,
    "secret"    TEXT NOT NULL,
    "events"    TEXT[],
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable AuditLog
CREATE TABLE "AuditLog" (
    "id"         TEXT NOT NULL,
    "productId"  TEXT NOT NULL,
    "instanceId" TEXT,
    "endpoint"   TEXT NOT NULL,
    "method"     TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "latencyMs"  INTEGER NOT NULL,
    "origin"     TEXT,
    "ip"         TEXT NOT NULL,
    "errorMsg"   TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable AdminUser
CREATE TABLE "AdminUser" (
    "id"           TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "email"        TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "type"         TEXT NOT NULL DEFAULT 'admin',
    "isActive"     BOOLEAN NOT NULL DEFAULT true,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable AdminActivityLog
CREATE TABLE "AdminActivityLog" (
    "id"          TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "action"      TEXT NOT NULL,
    "detail"      TEXT,
    "ip"          TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable HealthCheck
CREATE TABLE "HealthCheck" (
    "id"            TEXT NOT NULL,
    "vpsProviderId" TEXT NOT NULL,
    "status"        TEXT NOT NULL,
    "responseMs"    INTEGER NOT NULL,
    "errorMsg"      TEXT,
    "checkedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable BatchJob
CREATE TABLE "BatchJob" (
    "id"            TEXT NOT NULL,
    "productId"     TEXT NOT NULL,
    "instanceId"    TEXT,
    "totalMessages" INTEGER NOT NULL,
    "sentCount"     INTEGER NOT NULL DEFAULT 0,
    "failedCount"   INTEGER NOT NULL DEFAULT 0,
    "status"        TEXT NOT NULL DEFAULT 'processing',
    "completedAt"   TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");
CREATE UNIQUE INDEX "Product_apiKeyHash_key" ON "Product"("apiKeyHash");
CREATE UNIQUE INDEX "VpsServer_subdomain_key" ON "VpsServer"("subdomain");
CREATE UNIQUE INDEX "Instance_hubToken_key" ON "Instance"("hubToken");
CREATE UNIQUE INDEX "Instance_vpsProviderId_instanceName_key" ON "Instance"("vpsProviderId", "instanceName");
CREATE UNIQUE INDEX "Instance_productId_instanceName_key" ON "Instance"("productId", "instanceName");
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_vpsProviderId_fkey"
    FOREIGN KEY ("vpsProviderId") REFERENCES "VpsProvider"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VpsProvider" ADD CONSTRAINT "VpsProvider_vpsId_fkey"
    FOREIGN KEY ("vpsId") REFERENCES "VpsServer"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Instance" ADD CONSTRAINT "Instance_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Instance" ADD CONSTRAINT "Instance_vpsProviderId_fkey"
    FOREIGN KEY ("vpsProviderId") REFERENCES "VpsProvider"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WebhookConfig" ADD CONSTRAINT "WebhookConfig_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_instanceId_fkey"
    FOREIGN KEY ("instanceId") REFERENCES "Instance"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdminActivityLog" ADD CONSTRAINT "AdminActivityLog_adminUserId_fkey"
    FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HealthCheck" ADD CONSTRAINT "HealthCheck_vpsProviderId_fkey"
    FOREIGN KEY ("vpsProviderId") REFERENCES "VpsProvider"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BatchJob" ADD CONSTRAINT "BatchJob_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BatchJob" ADD CONSTRAINT "BatchJob_instanceId_fkey"
    FOREIGN KEY ("instanceId") REFERENCES "Instance"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
