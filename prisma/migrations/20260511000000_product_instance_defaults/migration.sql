-- CreateTable: ProductDefaultWebhook
CREATE TABLE IF NOT EXISTS "ProductDefaultWebhook" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "url" TEXT NOT NULL,
    "headers" JSONB,
    "byEvents" BOOLEAN NOT NULL DEFAULT false,
    "base64" BOOLEAN NOT NULL DEFAULT false,
    "events" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductDefaultWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ProductDefaultProxy
CREATE TABLE IF NOT EXISTS "ProductDefaultProxy" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "host" TEXT NOT NULL,
    "port" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "username" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductDefaultProxy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique productId on ProductDefaultWebhook
CREATE UNIQUE INDEX IF NOT EXISTS "ProductDefaultWebhook_productId_key" ON "ProductDefaultWebhook"("productId");

-- CreateIndex: unique productId on ProductDefaultProxy
CREATE UNIQUE INDEX IF NOT EXISTS "ProductDefaultProxy_productId_key" ON "ProductDefaultProxy"("productId");

-- AddForeignKey: ProductDefaultWebhook -> Product
ALTER TABLE "ProductDefaultWebhook"
    ADD CONSTRAINT "ProductDefaultWebhook_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: ProductDefaultProxy -> Product
ALTER TABLE "ProductDefaultProxy"
    ADD CONSTRAINT "ProductDefaultProxy_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
