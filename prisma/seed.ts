import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes, createCipheriv } from 'crypto';

const prisma = new PrismaClient();

// =============================================================================
// ENCRYPTION_KEY vem obrigatoriamente do .env — nunca hardcodada aqui.
// Deve ser um hex de 64 chars (32 bytes para AES-256-GCM).
// =============================================================================
const rawKey = process.env.ENCRYPTION_KEY;
if (!rawKey || rawKey.length !== 64) {
  console.error(
    '❌ ENCRYPTION_KEY inválida ou ausente no .env (deve ter 64 chars hex).',
  );
  process.exit(1);
}
const ENCRYPTION_KEY = Buffer.from(rawKey, 'hex');

function encrypt(text: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag().toString('base64');
  // Formato: iv:authTag:encrypted
  return `${iv.toString('base64')}:${authTag}:${encrypted}`;
}

function hashSha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function main() {
  console.log('🔄 Iniciando processo de Seeding...');

  // =============================================================================
  // Valores sensíveis lidos do .env — configure as vars SEED_* antes de rodar.
  // Veja .env.example para referência.
  // =============================================================================
  const vpsApiKey =
    process.env.SEED_VPS_API_KEY ?? 'dev-vps-api-key-placeholder';
  const vpsLabel = process.env.SEED_VPS_LABEL ?? 'VPS Desenvolvimento Local';
  const vpsSubdomain = process.env.SEED_VPS_SUBDOMAIN ?? 'vps-dev.local';
  const vpsUrl = process.env.SEED_VPS_URL ?? 'http://vps-dev.local';
  const vpsIp = process.env.SEED_VPS_IP ?? '127.0.0.1';
  const productName = process.env.SEED_PRODUCT_NAME ?? 'Produto Dev';
  const productSlug = process.env.SEED_PRODUCT_SLUG ?? 'produto-dev';
  const productApiKey =
    process.env.SEED_PRODUCT_API_KEY ?? 'sk_dev_placeholder_inseguro';
  const webhookUrl =
    process.env.SEED_WEBHOOK_URL ?? 'http://localhost:5678/webhook/dev';
  const webhookSecret =
    process.env.SEED_WEBHOOK_SECRET ?? 'webhook-secret-placeholder';

  // 1. Limpando dados antigos caso rode 2x
  await prisma.webhookConfig.deleteMany();
  await prisma.instance.deleteMany();
  await prisma.product.deleteMany();
  await prisma.vpsProvider.deleteMany();
  await prisma.vpsServer.deleteMany();

  // 2. Criptografa a API Key da VPS com AES-256-GCM
  const encryptedVpsKey = encrypt(vpsApiKey);

  // 3. Cadastrando a VPS
  const vps = await prisma.vpsServer.create({
    data: {
      label: vpsLabel,
      subdomain: vpsSubdomain,
      ip: vpsIp,
      isActive: true,
    },
  });
  console.log(`✅ VPS Criada: ${vps.label}`);

  // 3b. Cadastrando o VpsProvider associado à VPS
  const vpsProvider = await prisma.vpsProvider.create({
    data: {
      vpsId: vps.id,
      label: `${vpsLabel} — Provider Default`,
      providerUrl: vpsUrl,
      providerApiKey: encryptedVpsKey,
      adapterType: 'evolution',
      isActive: true,
    },
  });
  console.log(`✅ VpsProvider Criado: ${vpsProvider.label}`);

  // 4. Cadastrando o Produto
  const productHash = hashSha256(productApiKey);

  const product = await prisma.product.create({
    data: {
      name: productName,
      slug: productSlug,
      adapterType: 'evolution',
      vpsProviderId: vpsProvider.id,
      apiKeyHash: productHash,
      origins: ['frontend', 'cron-jobs'],
      hubRelay: false,
      isActive: true,
    },
  });
  console.log(`✅ Produto Cadastrado: ${product.name}`);
  console.log(
    `🔑 A API KEY desse produto é: ${productApiKey} (NUNCA será salva no banco)`,
  );

  // 5. Cadastrando Webhook
  const webhook = await prisma.webhookConfig.create({
    data: {
      productId: product.id,
      url: webhookUrl,
      secret: webhookSecret,
      events: ['MESSAGES_UPSERT'],
    },
  });
  console.log(`✅ Webhook Configurado para Produto na URL: ${webhook.url}`);

  console.log('🎉 Seed completo e banco local rodando certinho!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
